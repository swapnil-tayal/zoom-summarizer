const fs = require('fs-extra');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
ffmpeg.setFfmpegPath(ffmpegPath);
const OpenAI = require('openai');
const { Builder, By, Key } = require("selenium-webdriver")
const chrome = require("selenium-webdriver/chrome");
const path = require("path");
const dotenv = require("dotenv");
dotenv.config();
let chrome_options = new chrome.Options();
const downloadPath = path.resolve(__dirname, "downloads");
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
chrome_options.addArguments("--headless");
let openaiKey = process.env.OPEN_AI_KEY;

const express = require("express");
const cors = require('cors');

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

const getFileName = (str) => {
  let n = str.length;
  let cnt = 0;
  let i = 0;
  let res = "";
  while(i<n){
    if(str[i] === '/') cnt++;
    if(cnt === 8){
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
  console.log("Trying reading the Zoom Data")
  let transcriptFilepath = "downloads/" + getFileName(src) + "_Recording.transcript.vtt";
  let audioPath = "downloads/" + getFileName(src) + "_Recording.m4a";
  console.log(audioPath);

  try{
    const data = await fs.readFile(transcriptFilepath, 'utf8');
    let lines = data.split('\n');
    let cleanLines = lines.filter(line => !(/^\d+\n|\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}$/.test(line.trim())));
    cleanLines = cleanLines.filter(cleanLines => !(/^\d+$/.test(cleanLines.trim())) && cleanLines.trim() !== '')
    let cleanText = cleanLines.join('\n').trim();
    console.log("Got the transcript file Data");
    return cleanText;
  }catch{
    console.log("not found transcript, trying with Audio");
    try {    
      const compressedAudioPath = "downloads/audio.mp3";
      await compressAudio(audioPath, compressedAudioPath);
      console.log("Audio compressed successfully.");
      const openai = new OpenAI({ apiKey: openaiKey });
      const transcription = await openai.audio.transcriptions.create({
        file: fs.createReadStream(compressedAudioPath),
        model: "whisper-1",
        response_format: "verbose_json",
        timestamp_granularities: ["word"]
      });
      console.log("Got with Audio Text");
      return transcription.text;
    } catch (err) {
      console.error(`Error reading the Audio file: ${err}`);
    }
  }
};

async function summarizeTranscript(transcript) {
  console.log("started with Open AI");
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
            content: 'You are a helpful assistant that summarizes meeting transcripts, 1 Mention all the Speakers. 2 Topics covered, 3 Tone of meeting. 4 Outcomes, 5 next steps, 6 Detailed Summary atleast 500 words. Return the reponse in HTML format',
          },
          {
            role: 'user',
            content: transcript,
          },
        ],
      }),
    });
    if(response.ok){
      const data = await response.json();
      const summary = data.choices[0].message.content;
      console.log("got the response from Open AI");
      return summary;
    }
  } catch (error) {
    console.error('Error summarizing transcript:', error.message);
  }
}

async function exp(url, passcode){
  
  deleteDownloadIfExists();
  let drivers = await new Builder().forBrowser("chrome").setChromeOptions(chrome_options).build();
  await drivers.get(url);
  await drivers.sleep(5000);
  await drivers.findElement(By.id("passcode")).sendKeys(passcode, Key.RETURN);
  await drivers.sleep(8000);
  await drivers.findElement(By.xpath('/html/body/div[1]/div[4]/div[2]/div[2]/header/div/div[3]/div/a')).click();

  const videoDiv = await drivers.findElement(By.xpath('/html/body/div[1]/div[4]/div[2]/div[2]/section/div/div[3]/div[1]/div/div[1]/video'));
  let src = await videoDiv.getAttribute('src');
  await drivers.sleep(15000);
  await drivers.quit();
  console.log("files Downloaded from Selenium");
  var data = await readFile(src);
  deleteDownloadIfExists();
  const zoomTranscript = data;  
  let res = await summarizeTranscript(zoomTranscript);
  return res;
}

app.get("/isokay", async(req, res) => { 
  try{
    res.status(201).json("yes");
  }catch(e){
    res.status(409).json({ message: e.message });
  }
})

app.post("/test", async(req, res) => { 
  console.log("hitted api");
  const {url, password} =  req.body;
  try{
    console.log(url, password);
    const data = await exp(url, password);
    res.status(201).json(data);
  }catch(e){
    res.status(409).json({ message: e.message });
  }
})
const PORT = 5500;
app.listen(PORT, () => {
  console.log(`Server running at ${PORT}`)
})
2