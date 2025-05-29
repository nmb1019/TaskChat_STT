// session.js - STT/TTS版 音声会話管理

// バックエンドURL
const BACKEND_URL = '';

// グローバル状態
const globalState = {
  mediaRecorder: null,
  audioChunks: [],
  isRecording: false,
  conversationHistory: [],
  isProcessing: false
};

/**
 * 録音開始
 */
async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    
    globalState.mediaRecorder = new MediaRecorder(stream, {
      mimeType: 'audio/webm'
    });
    
    globalState.audioChunks = [];
    
    globalState.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        globalState.audioChunks.push(event.data);
      }
    };
    
    globalState.mediaRecorder.onstop = async () => {
      const audioBlob = new Blob(globalState.audioChunks, { type: 'audio/webm' });
      await processAudio(audioBlob);
    };
    
    globalState.mediaRecorder.start();
    globalState.isRecording = true;
    
    updateUIState('recording');
    console.log('Recording started');
    
  } catch (error) {
    console.error('Error starting recording:', error);
    alert('マイクへのアクセスに失敗しました: ' + error.message);
  }
}

/**
 * 録音停止
 */
function stopRecording() {
  if (globalState.mediaRecorder && globalState.isRecording) {
    globalState.mediaRecorder.stop();
    globalState.isRecording = false;
    updateUIState('processing');
    console.log('Recording stopped');
    
    // マイクのストリームを停止
    globalState.mediaRecorder.stream.getTracks().forEach(track => track.stop());
  }
}

/**
 * 音声を処理（STT → GPT-4o → TTS）
 */
async function processAudio(audioBlob) {
  if (globalState.isProcessing) return;
  
  globalState.isProcessing = true;
  
  try {
    const formData = new FormData();
    formData.append('audio', audioBlob, 'recording.webm');
    
    const response = await fetch(`${BACKEND_URL}/process-audio`, {
      method: 'POST',
      body: formData
    });
    
    if (!response.ok) {
      throw new Error(`サーバーエラー: ${response.status}`);
    }
    
    const data = await response.json();
    
    // 会話履歴に追加
    addToConversation('user', data.userText);
    addToConversation('ai', data.aiReply);
    
    // 音声を再生
    playAudioResponse(data.audioData);
    
  } catch (error) {
    console.error('Error processing audio:', error);
    alert('音声処理中にエラーが発生しました: ' + error.message);
  } finally {
    globalState.isProcessing = false;
    updateUIState('ready');
  }
}

/**
 * 音声応答を再生
 */
function playAudioResponse(audioDataUrl) {
  const audio = new Audio(audioDataUrl);
  
  audio.onended = () => {
    console.log('Audio playback finished');
    updateUIState('ready');
  };
  
  audio.onerror = (error) => {
    console.error('Audio playback error:', error);
    updateUIState('ready');
  };
  
  audio.play().catch(error => {
    console.error('Failed to play audio:', error);
    updateUIState('ready');
  });
}

/**
 * 会話履歴に追加
 */
function addToConversation(speaker, text) {
  const conversationDiv = document.getElementById('conversation');
  if (!conversationDiv) return;
  
  const entry = document.createElement('div');
  entry.innerHTML = `<span class="${speaker}">${speaker === 'user' ? 'You' : 'AI'}: </span>${text}`;
  conversationDiv.appendChild(entry);
  conversationDiv.scrollTop = conversationDiv.scrollHeight;
  
  // グローバル履歴にも追加
  globalState.conversationHistory.push({ speaker, text });
}

/**
 * UIの状態を更新
 */
function updateUIState(state) {
  const recordBtn = document.getElementById('recordBtn');
  const statusDiv = document.getElementById('callStatus');
  
  switch (state) {
    case 'ready':
      if (recordBtn) {
        recordBtn.textContent = '録音開始';
        recordBtn.disabled = false;
        recordBtn.classList.remove('recording');
      }
      if (statusDiv) statusDiv.textContent = '待機中';
      break;
      
    case 'recording':
      if (recordBtn) {
        recordBtn.textContent = '録音停止';
        recordBtn.disabled = false;
        recordBtn.classList.add('recording');
      }
      if (statusDiv) statusDiv.textContent = '録音中...';
      break;
      
    case 'processing':
      if (recordBtn) {
        recordBtn.textContent = '処理中...';
        recordBtn.disabled = true;
        recordBtn.classList.remove('recording');
      }
      if (statusDiv) statusDiv.textContent = '処理中...';
      break;
  }
}

/**
 * 録音ボタンのトグル
 */
function toggleRecording() {
  if (globalState.isRecording) {
    stopRecording();
  } else {
    startRecording();
  }
}

/**
 * タスク設定を読み込む
 */
async function loadTaskConfig() {
  try {
    const response = await fetch(`${BACKEND_URL}/task-config`);
    if (response.ok) {
      const config = await response.json();
      
      const taskTitle = document.getElementById('taskTitle');
      const taskDescription = document.getElementById('taskDescription');
      
      if (taskTitle) taskTitle.textContent = config.title;
      if (taskDescription) taskDescription.textContent = config.description;
    }
  } catch (error) {
    console.error("Failed to load task config:", error);
  }
}

/**
 * 会話をリセット
 */
async function resetConversation() {
  try {
    await fetch(`${BACKEND_URL}/reset-conversation`, {
      method: 'POST'
    });
    
    // UIをクリア
    const conversationDiv = document.getElementById('conversation');
    if (conversationDiv) {
      conversationDiv.innerHTML = '';
    }
    
    // ローカル履歴もクリア
    globalState.conversationHistory = [];
    
    console.log('Conversation reset');
  } catch (error) {
    console.error('Failed to reset conversation:', error);
  }
}

// ページ読み込み時の初期化
document.addEventListener("DOMContentLoaded", function() {
  console.log("Page loaded - STT/TTS version");
  
  // タスク設定を読み込む
  loadTaskConfig();
  
  const recordBtn = document.getElementById('recordBtn');
  const resetBtn = document.getElementById('resetBtn');
  const toggleTranscript = document.getElementById('toggleTranscript');
  const conversationBox = document.getElementById('conversation');
  
  if (recordBtn) {
    recordBtn.addEventListener('click', toggleRecording);
  }
  
  if (resetBtn) {
    resetBtn.addEventListener('click', resetConversation);
  }
  
  // 文字起こしの表示/非表示切り替え
  if (toggleTranscript && conversationBox) {
    toggleTranscript.addEventListener('click', function() {
      if (conversationBox.style.display === 'none') {
        conversationBox.style.display = 'block';
        toggleTranscript.textContent = '文字起こしを隠す';
      } else {
        conversationBox.style.display = 'none';
        toggleTranscript.textContent = '文字起こしを表示';
      }
    });
  }
});