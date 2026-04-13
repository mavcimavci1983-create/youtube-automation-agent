const { GoogleAuth } = require('google-auth-library');
const fs = require('fs');

class CredentialManager {
  constructor() {
    this.credentials = null;
  }

  async getGeminiKey() {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error('GEMINI_API_KEY bulunamadı!');
    return key;
  }

  async getYouTubeAuth() {
    const auth = new GoogleAuth({
      keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      scopes: ['https://www.googleapis.com/auth/youtube.upload'],
    });
    return auth;
  }

  validate() {
    const required = ['GEMINI_API_KEY', 'YOUTUBE_CHANNEL_ID'];
    const missing = required.filter(k => !process.env[k]);
    if (missing.length > 0) {
      throw new Error(`Eksik env değişkenler: ${missing.join(', ')}`);
    }
    console.log('✅ Tüm credentials doğrulandı.');
  }
}

module.exports = new CredentialManager();
