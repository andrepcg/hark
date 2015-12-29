var WildEmitter = require('wildemitter');

function getVolume (fftBins) {
  var ret = {
    max: 0,
    average: 0
  };

  // Root mean square instead of simple average
  for(var i = 0; i < fftBins.length; i++) {
    ret.average += fftBins[i] * fftBins[i];
    if (fftBins[i] > ret.max) {
      ret.max = fftBins[i];
    }
  }
  var rms =  Math.sqrt(ret.average / fftBins.length);
  ret.average = rms;
  
  ret.average /= 255;
  ret.max /= 255;

  return ret;
}


var audioContextType = window.AudioContext || window.webkitAudioContext;
// use a single audio context due to hardware limits
var audioContext = null;
module.exports = function(stream, options) {
  var harker = new WildEmitter();


  // make it not break in non-supported browsers
  if (!audioContextType) return harker;

  //Config
  var options = options || {},
      smoothing = (options.smoothing || 0.1),
      interval = (options.interval || 50),
      threshold = options.threshold,
      play = options.play,
      history = options.history || 1h,
      running = true;

  //Setup Audio Context
  if (!audioContext) {
    audioContext = new audioContextType();
  }
  var sourceNode, fftBins, analyser;

  analyser = audioContext.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = smoothing;
  fftBins = new Uint8Array(analyser.fftSize);

  if (stream.jquery) stream = stream[0];
  if (stream instanceof HTMLAudioElement || stream instanceof HTMLVideoElement) {
    //Audio Tag
    sourceNode = audioContext.createMediaElementSource(stream);
    if (typeof play === 'undefined') play = true;
    threshold = threshold || 0.5;
  } else {
    //WebRTC Stream
    sourceNode = audioContext.createMediaStreamSource(stream);
    threshold = threshold || 0.5;
  }

  sourceNode.connect(analyser);
  if (play) analyser.connect(audioContext.destination);

  harker.speaking = false;

  harker.setThreshold = function(t) {
    threshold = t;
  };

  harker.setInterval = function(i) {
    interval = i;
  };
  
  harker.stop = function() {
    running = false;
    harker.emit('volume_change', 0, threshold);
    if (harker.speaking) {
      harker.speaking = false;
      harker.emit('stopped_speaking');
    }
  };
  harker.speakingHistory = [];
  for (var i = 0; i < history; i++) {
      harker.speakingHistory.push(0);
  }

  // Poll the analyser node to determine if speaking
  // and emit events if changed
  var looper = function() {
    setTimeout(function() {
    
      //check if stop has been called
      if(!running) {
        return;
      }
      
      analyser.getByteFrequencyData(fftBins);
      var vol = getVolume(fftBins);
      var currentVolume = vol.average;

      harker.emit('volume_change', currentVolume, threshold);

      var history = 0;
      if (currentVolume > threshold && !harker.speaking) {
        // trigger quickly, short history
        for (var i = harker.speakingHistory.length - 3; i < harker.speakingHistory.length; i++) {
          history += harker.speakingHistory[i];
        }
        if (history >= 2) {
          harker.speaking = true;
          harker.emit('speaking');
        }
      } else if (currentVolume < threshold && harker.speaking) {
        for (var i = 0; i < harker.speakingHistory.length; i++) {
          history += harker.speakingHistory[i];
        }
        if (history == 0) {
          harker.speaking = false;
          harker.emit('stopped_speaking');
        }
      }
      harker.speakingHistory.shift();
      harker.speakingHistory.push(0 + (currentVolume > threshold));

      looper();
    }, interval);
  };
  looper();


  return harker;
}
