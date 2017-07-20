'use strict'

const GoogleAssistant = require('google-assistant')
const recorder = require('node-record-lpcm16')
const player = require('play-sound')({player: 'afplay'})
const Speaker = require('speaker')
const snowboy = require('snowboy')

const config = {
  auth: {
    keyFilePath: __dirname + '/secrets.json',
    savedTokensPath: __dirname + '/tokens.js',
  },
  audio: {
    ding: __dirname + '/resources/ding.wav',
    encodingIn: 'LINEAR16', // supported are LINEAR16 / FLAC (defaults to LINEAR16)
    sampleRateOut: 24000, // supported are 16000 / 24000 (defaults to 24000)
  },
}

const hotwordModels = new snowboy.Models()

hotwordModels.add({
  file: __dirname + '/resources/snowboy.umdl',
  sensitivity: '0.7',
  hotwords: 'snowboy',
})

const detector = new snowboy.Detector({
  resource: 'resources/common.res',
  models: hotwordModels,
  audioGain: 2.0,
})

let hotwordMic
let conversationTimer

function startAssistant() {
  assistant.start(conversation => {
    conversationTimer = setTimeout(() => {
      console.log('timeout')
      conversation.timeout()
    }, 10000)
  })
}

const startConversation = conversation => {
  let spokenResponseLength = 0
  let speakerOpenTime
  let speakerTimer

  // pass the mic audio to the assistant
  const mic = recorder.record({threshold: 0})
  let micStopped = false
  mic.stream().on('data', data => {
    if (!micStopped) {
      conversation.write(data)
    }
  })

  conversation.timeout = () => {
    micStopped = true
    mic.stop()
    conversation.end()
  }

  // setup the conversation
  conversation
    // send the audio buffer to the speaker
    .on('audio-data', data => {
      const now = new Date().getTime()
      speaker.write(data)

      // kill the speaker after enough data has been sent to it and then let it flush out
      spokenResponseLength += data.length
      const audioTime =
        spokenResponseLength / (config.audio.sampleRateOut * 16 / 8) * 1000
      clearTimeout(speakerTimer)
      speakerTimer = setTimeout(() => {
        speaker.end()
      }, audioTime - Math.max(0, now - speakerOpenTime))
    })
    // done speaking, close the mic
    .on('end-of-utterance', () => {
      console.log('end-of-utterance')
      mic.stop()
      micStopped = true
      clearTimeout(conversationTimer)
    })
    // just to spit out to the console what was said
    .on('transcription', text => console.log('Transcription:', text))
    // once the conversation is ended, see if we need to follow up
    .on('ended', (error, continueConversation) => {
      if (error) console.log('Conversation Ended Error:', error)
      else if (continueConversation) {
        console.log('continue')
        startAssistant()
      } else {
        console.log('Conversation Complete')
        hotwordMic.start().stream().pipe(detector, {end: false})
      }
    })
    // catch any errors
    .on('error', error => {
      // Reset can happen if google does not hear anything for a while,
      // just restart hotword detection
      if (error.message === 'Received RST_STREAM with error code 0') {
        console.error('Reset', error)
        hotwordMic.start().stream().pipe(detector, {end: false})
      } else {
        console.log('Conversation Error:', error)
      }
    })
    .on('end', () => {
      console.log('end')
      if (!micStopped) {
        micStopped = true
        mic.stop()
      }
    })

  // setup the speaker
  const speaker = new Speaker({
    channels: 1,
    sampleRate: config.audio.sampleRateOut,
  })
  speaker
    .on('open', () => {
      console.log('Assistant Speaking')
      speakerOpenTime = new Date().getTime()
    })
    .on('close', () => {
      console.log('Assistant Finished Speaking')
      conversation.end()
    })
}

// setup the assistant
const assistant = new GoogleAssistant(config)
assistant
  .on('ready', () => {
    // Setup hotword detection
    hotwordMic = recorder.record({
      threshold: 0,
    })

    detector.on('error', function(error) {
      console.log('hotword detector error', error)
    })

    detector.on('hotword', function(index, hotword, buffer) {
      // <buffer> contains the last chunk of the audio that triggers the "hotword"
      // event. It could be written to a wav stream. You will have to use it
      // together with the <buffer> in the "sound" event if you want to get audio
      // data after the hotword.
      // console.log(buffer);
      console.log('hotword', index, hotword)
      hotwordMic.stop()
      // Play ding to let the user know Google is listening
      player.play(config.audio.ding, function(err, stdout, stderr) {
        if (err) throw err
        console.log(stdout)
        console.log(stderr)
      })
      startAssistant()
    })

    console.log('Listening')

    hotwordMic.stream().pipe(detector, {end: false})
  })
  .on('started', startConversation)
  .on('error', error => {
    console.log('Assistant Error:', error)
  })
