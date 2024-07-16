const fs = require('fs-extra');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const express = require("express");
const cors = require('cors');
const OpenAI = require('openai');
const { Builder, By, Key } = require("selenium-webdriver")
const chrome = require("selenium-webdriver/chrome");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config();
let chrome_options = new chrome.Options();
const downloadPath = path.resolve(__dirname, "downloads");
const logFileName = "logs.txt";
chrome_options.setUserPreferences({
  "download.default_directory": downloadPath,
  "download.prompt_for_download": false,
  "download.directory_upgrade": true,
  "safebrowsing.enabled": true,
  "profile.default_content_settings.popups": 0,  // Disable popups
  "profile.default_content_setting_values.automatic_downloads": 1, // Allow automatic
});
// Handle SSL certificate errors
chrome_options.addArguments("--ignore-certificate-errors");
chrome_options.addArguments("--ignore-ssl-errors=true");
// chrome_options.addArguments("--headless");
let openaiKey = process.env.OPEN_AI_KEY;

ffmpeg.setFfmpegPath(ffmpegPath);
const app = express();
app.use(express.json());
app.use(cors());  

const deleteDownloadIfExists = () => {
  const folderName = 'downloads';  
  if (fs.existsSync(folderName)) {
    fs.rmdir(folderName, { recursive: true, force: true }, err => {
      if (err) throw err;
    });
  }
}
const deleteLogsIfExists = () => {
  const fileName = logFileName;  
  if (fs.existsSync(fileName)) {
    fs.unlink(fileName, err => {
      if (err) throw err;
      console.log(`${fileName} was deleted`);
    });
  } else {
    console.log(`${fileName} does not exist`);
  }
};
const getFileName = (str) => {
  let n = str.length;
  let cnt = 0;
  let i = 0;
  let res = "";
  while(i<n){
    if(str[i] === '/' && str[i+1] === 'G' && str[i+2] === 'M' && str[i+3] === 'T'){
      i++;
      while(str[i] !== '_'){
        res += str[i];
        i++;
      }
      break;
    }
    i++;
  }
  return res;
}
const compressAudio = (inputPath, outputPath, bitrate = '128k', duration = '15:00') => {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .audioCodec('libmp3lame')
      .audioBitrate(bitrate)
      .duration(duration)
      .on('error', reject)
      .on('end', resolve)
      .save(outputPath);
  });
};
const readFile = async (src) => {

  addLogs(logFileName, "Trying reading the Zoom Data");
  let transcriptFilepath = "downloads/" + getFileName(src) + "_Recording.transcript.vtt";
  let audioPath = "downloads/" + getFileName(src) + "_Recording.m4a";

  try{

    const data = await fs.readFile(transcriptFilepath, 'utf8');
    let lines = data.split('\n');
    let cleanLines = lines.filter(line => !(/^\d+\n|\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}$/.test(line.trim())));
    cleanLines = cleanLines.filter(cleanLines => !(/^\d+$/.test(cleanLines.trim())) && cleanLines.trim() !== '')
    let cleanText = cleanLines.join('\n').trim();
    addLogs(logFileName, "Got the transcript file Data");
    return cleanText;

  }catch{

    addLogs(logFileName, "Not found transcript, Trying with Audio, Compressing Audio");

    try {    
      const compressedAudioPath = "downloads/audio.mp3";
      await compressAudio(audioPath, compressedAudioPath);
      addLogs(logFileName, "Audio compressed successfully, Trying Audio to Text");
      const openai = new OpenAI({ apiKey: openaiKey });
      const transcription = await openai.audio.transcriptions.create({
        file: fs.createReadStream(compressedAudioPath),
        model: "whisper-1",
        response_format: "verbose_json",
        timestamp_granularities: ["word"]
      });

      addLogs(logFileName, "Got with Audio Text");
      return transcription.text;

    } catch (err) {
      
      addLogs(logFileName, `Error reading the Audio file: ${err}`);
      console.error(`Error reading the Audio file: ${err}`);
    }
  }
};
async function summarizeTranscript(transcript) {

  addLogs(logFileName, "Started with Open AI");

  try {

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant that summarizes meeting transcripts, 1 Mention all the Speakers. 2 Topics covered, 3 Tone of meeting. 4 Outcomes, 5 next steps, 6 Detailed Summary atleast 500 words. Return the reponse wrapped inside html tags',
          },
          {
            role: 'user',
            content: transcript,
          },
        ],
      }),

    });
      const data = await response.json();
      const summary = data.choices[0].message.content;
      addLogs(logFileName, "Got the response from Open AI");
      return summary;
  } catch (error) {

    addLogs(logFileName, `Error summarizing transcript:, ${error.message}`);
    console.error('Error summarizing transcript:', error.message);

  }
}
const createLogFile = (logFileName) => {
  fs.writeFile(logFileName, '', (err) => {
    if (err) {
      console.error('An error occurred while creating log file:', err);
      return;
    }
    console.log('LOGS file created');
  });
}
const addLogs = (fileName, text) => {
  text += "#";
  fs.appendFile(fileName, text, (err) => {
    if (err) {
      console.error('An error occurred while appending to the file:', err);
      return;
    }
    console.log(`log ${text}`);
  });
}
async function fileExists(filePath) {
  try {
    await fs.stat(filePath);
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') {
      return false;
    }
    throw err; // Propagate other errors
  }
}
const readLogs = async (filePath) => {
  if(fileExists(filePath)){
    try {
      const data = await fs.readFile(filePath, 'utf8');
      return data;
    } catch (err) {
      throw err;
    }
  }else return "no logs";
}


async function exp(url, passcode){
  
  deleteDownloadIfExists();
  deleteLogsIfExists();
  createLogFile(logFileName);
  addLogs(logFileName, "Got the Request");
  let drivers = await new Builder().forBrowser("chrome").setChromeOptions(chrome_options).build();
  await drivers.get(url);
  await drivers.sleep(5000);
  addLogs(logFileName, "Zoom Url Hit");
  await drivers.findElement(By.id("passcode")).sendKeys(passcode, Key.RETURN);
  await drivers.sleep(8000);
  addLogs(logFileName, "Into Zoom Dashboard");
  await drivers.findElement(By.xpath('/html/body/div[1]/div[4]/div[2]/div[2]/header/div/div[3]/div/a')).click();
  const videoDiv = await drivers.findElement(By.xpath('/html/body/div[1]/div[4]/div[2]/div[2]/section/div/div[3]/div[1]/div/div[1]/video'));
  let src = await videoDiv.getAttribute('src');
  addLogs(logFileName, "Started Downloading ~ Selenium");
  await drivers.sleep(15000);
  await drivers.quit();
  addLogs(logFileName, "Files Downloaded ~ Selenium");
  var data = await readFile(src);
  deleteDownloadIfExists();
  const zoomTranscript = data;  
  let res = await summarizeTranscript(zoomTranscript);
  deleteLogsIfExists();
  return res;

}

app.post("/getLogs", async(req, res) => {
  console.log("in logs");
  try{
    const logs = await readLogs(logFileName);
    console.log(logs);
    res.status(201).json(logs);
  }catch(e){
    res.status(409).json({ message: e.message });
  }   
})

app.get("/isokay", async(req, res) => { 
  try{
    res.status(201).json("yes");
  }catch(e){
    res.status(409).json({ message: e.message });
  }
})

app.post("/test", async(req, res) => { 
  const {url, password} =  req.body;
  try{
    const data = await exp(url, password);
    res.status(201).json(data);
  }catch(e){
    res.status(409).json({ message: e.message });
  }
})
const PORT = 5500;
app.listen(PORT, async () => {
  console.log(`Server running at ${PORT}`)
})