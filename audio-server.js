// audio-server.js - STT/TTS版 タスクチャットサーバー
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import multer from 'multer';
import FormData from 'form-data';

const app = express();

// CORS設定
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
}));

app.use(express.json());

// 静的ファイルの配信設定
app.use(express.static('public'));

// ファイルアップロード設定
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// 環境変数
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// 会話履歴を保持（セッションごとに管理する場合は改良が必要）
const conversationHistory = [];

// ルートエンドポイント
app.get('/', (req, res) => {
  res.status(200).json({
    message: 'タスクチャット STT/TTS版サーバー',
    version: '1.0.0',
    endpoints: {
      '/task-config': 'タスク設定を取得',
      '/transcribe': '音声をテキストに変換（Speech to Text）',
      '/chat': 'GPT-4oでチャット応答を生成',
      '/synthesize': 'テキストを音声に変換（Text to Speech）',
      '/process-audio': '音声処理の一括エンドポイント'
    }
  });
});

// タスク設定を返すエンドポイント
app.get('/task-config', (req, res) => {
  res.json({
    title: process.env.TASK_TITLE || "英会話練習",
    description: process.env.TASK_DESCRIPTION || "AIと英語で会話を楽しんでください。"
  });
});

/**
 * Speech to Text - 音声をテキストに変換
 */
app.post('/transcribe', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "音声ファイルが必要です" });
    }

    const formData = new FormData();
    formData.append('file', req.file.buffer, {
      filename: 'audio.webm',
      contentType: req.file.mimetype
    });
    formData.append('model', 'whisper-1');
    formData.append('language', 'en');

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        ...formData.getHeaders()
      },
      body: formData
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Whisper API error:', error);
      return res.status(response.status).json({ error });
    }

    const data = await response.json();
    console.log('Transcribed:', data.text);
    
    res.json({ text: data.text });
  } catch (error) {
    console.error('Transcription error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GPT-4oでチャット応答を生成
 */
app.post('/chat', async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: "メッセージが必要です" });
    }

    // 環境変数からAIへの指示を取得
    const aiInstruction = process.env.AI_INSTRUCTION || 
      "You are a helpful English conversation partner. Please speak clearly and help the user practice English.";

    // 会話履歴に追加
    conversationHistory.push({ role: 'user', content: message });

    // GPT-4oに送信
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: aiInstruction },
          ...conversationHistory.slice(-10) // 最新10件の履歴のみ使用
        ],
        max_tokens: 150,
        temperature: 0.7
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('GPT-4o API error:', error);
      return res.status(response.status).json({ error });
    }

    const data = await response.json();
    const reply = data.choices[0].message.content;
    
    // 会話履歴に追加
    conversationHistory.push({ role: 'assistant', content: reply });
    
    console.log('GPT-4o reply:', reply);
    res.json({ reply });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Text to Speech - テキストを音声に変換
 */
app.post('/synthesize', async (req, res) => {
  try {
    const { text } = req.body;
    
    if (!text) {
      return res.status(400).json({ error: "テキストが必要です" });
    }

    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini-tts',
        input: text,
        voice: 'coral',
        instructions: 'Speak in a clear, helpful, and encouraging tone. Use a moderate pace suitable for English learners.',
        response_format: 'mp3'
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('TTS API error:', error);
      return res.status(response.status).json({ error });
    }

    // 音声データを直接返す
    const buffer = await response.buffer();
    res.set('Content-Type', 'audio/mp3');
    res.send(buffer);
  } catch (error) {
    console.error('TTS error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 音声処理の一括エンドポイント
 * 音声 → テキスト → GPT-4o → 音声
 */
app.post('/process-audio', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "音声ファイルが必要です" });
    }

    // 1. Speech to Text
    const formData = new FormData();
    formData.append('file', req.file.buffer, {
      filename: 'audio.webm',
      contentType: req.file.mimetype
    });
    formData.append('model', 'whisper-1');
    formData.append('language', 'en');

    const whisperResponse = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        ...formData.getHeaders()
      },
      body: formData
    });

    if (!whisperResponse.ok) {
      throw new Error('音声認識に失敗しました');
    }

    const whisperData = await whisperResponse.json();
    const userText = whisperData.text;
    console.log('User said:', userText);

    // 2. GPT-4oで応答生成
    const aiInstruction = process.env.AI_INSTRUCTION || 
      "You are a helpful English conversation partner. Please speak clearly and help the user practice English.";

    conversationHistory.push({ role: 'user', content: userText });

    const gptResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: aiInstruction },
          ...conversationHistory.slice(-10)
        ],
        max_tokens: 150,
        temperature: 0.7
      })
    });

    if (!gptResponse.ok) {
      throw new Error('応答生成に失敗しました');
    }

    const gptData = await gptResponse.json();
    const aiReply = gptData.choices[0].message.content;
    conversationHistory.push({ role: 'assistant', content: aiReply });
    console.log('AI reply:', aiReply);

    // 3. Text to Speech
    const ttsResponse = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini-tts',
        input: aiReply,
        voice: 'coral',
        instructions: 'Speak in a clear, helpful, and encouraging tone. Use a moderate pace suitable for English learners.',
        response_format: 'mp3'
      })
    });

    if (!ttsResponse.ok) {
      throw new Error('音声合成に失敗しました');
    }

    const audioBuffer = await ttsResponse.buffer();
    
    // Base64エンコードして返す
    const audioBase64 = audioBuffer.toString('base64');
    
    res.json({
      userText,
      aiReply,
      audioData: `data:audio/mp3;base64,${audioBase64}`
    });
  } catch (error) {
    console.error('Process audio error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 会話履歴をリセット
app.post('/reset-conversation', (req, res) => {
  conversationHistory.length = 0;
  res.json({ message: '会話履歴をリセットしました' });
});

// サーバー起動
const PORT = process.env.PORT || 3003;
app.listen(PORT, () => {
  console.log(`STT/TTS版サーバーがポート ${PORT} で起動しました`);
  console.log(`http://localhost:${PORT}`);
});