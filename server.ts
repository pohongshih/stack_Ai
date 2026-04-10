import express from 'express';
import { createServer as createViteServer } from 'vite';
import YahooFinance from 'yahoo-finance2';
import { GoogleGenAI } from '@google/genai';
import path from 'path';

const yahooFinance = new (YahooFinance as any)();
let aiClient: GoogleGenAI | null = null;

function getAIClient(): GoogleGenAI {
  if (!aiClient) {
    let key = process.env.GEMINI_API_KEY || process.env.API_KEY;
    if (!key) {
      throw new Error('API Key is not set. Please configure GEMINI_API_KEY or API_KEY in the Secrets panel.');
    }
    key = key.trim();
    aiClient = new GoogleGenAI({ apiKey: key });
  }
  return aiClient;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API: Get Stock Data
  app.get('/api/stock/:symbol', async (req, res) => {
    try {
      const { symbol } = req.params;
      const queryOptions = { lang: 'zh-Hant-TW', region: 'TW' };
      
      const quote = await yahooFinance.quote(symbol, queryOptions);
      if (!quote) throw new Error('找不到該股票代碼的報價資料');
      
      const end = new Date();
      const start = new Date();
      start.setMonth(start.getMonth() - 6); // 6 months of historical data
      
      let historical = [];
      try {
        historical = await yahooFinance.historical(symbol, { period1: start, period2: end, interval: '1d' });
      } catch (e) {
        console.warn(`Historical data not found for ${symbol}`);
      }

      let news = [];
      try {
        // Remove .TW or .TWO to get more relevant local news from Yahoo
        const cleanSymbol = symbol.replace('.TW', '').replace('.TWO', '');
        const searchRes = await yahooFinance.search(cleanSymbol, { newsCount: 5, ...queryOptions }) as any;
        news = searchRes.news || [];
      } catch (e) {
        console.warn(`News not found for ${symbol}`);
      }

      res.json({ quote, historical, news });
    } catch (error: any) {
      console.error('Error fetching stock data:', error);
      res.status(500).json({ error: error.message || 'Failed to fetch stock data' });
    }
  });

  // API: Search Taiwan Stocks
  app.get('/api/search/:query', async (req, res) => {
    try {
      const { query } = req.params;
      const results = await yahooFinance.search(query, { lang: 'zh-Hant-TW', region: 'TW' }) as any;
      const twStocks = results.quotes.filter((q: any) => 
        q.symbol.endsWith('.TW') || q.symbol.endsWith('.TWO')
      );
      res.json({ results: twStocks });
    } catch (error) {
      console.error('Error searching stocks:', error);
      res.status(500).json({ error: 'Search failed' });
    }
  });

  // API: Analyze Stock
  app.post('/api/analyze', async (req, res) => {
    try {
      const { symbol, quote, historical, news } = req.body;

      const currentPrice = quote.regularMarketPrice;
      const newsHeadlines = news.map((n: any, i: number) => `[${i}] ${n.title}`).join('\n');

      const prompt = `
你是一位專業的台股分析師。請根據以下即時資料，對台灣股市標的 ${symbol} 進行客觀的技術分析與策略建議。

【目前股價】: ${currentPrice}
【近期新聞標題】:
${newsHeadlines}

請務必以 JSON 格式回傳，包含以下欄位（請勿包含 Markdown 語法如 \`\`\`json，直接輸出 JSON 字串即可）：
{
  "recommendation": "強烈買進 | 買進 | 觀望持有 | 賣出 | 強烈賣出",
  "technicalAnalysis": "技術面分析結果（包含均線、RSI、MACD等型態判斷，約 50 字）",
  "newsSummary": "近期新聞重點整理與小結（請用 2-3 點條列式總結新聞帶來的影響）",
  "analysisSummary": "結合基本面與消息面的綜合分析段落（約 50-100 字）",
  "strategy": {
    "buyPrice": "建議買點（如 NT$1000）",
    "stopLoss": "停損價（如 NT$950）",
    "targetPrice": "目標賣出價（如 NT$1100）",
    "potentialReturn": "潛在報酬率（如 +10.0%）"
  },
  "newsSentiment": [
    { "index": 0, "sentiment": "利多 | 利空 | 中立" }
  ],
  "foreignInvestment": "外資動向推估（如 '+899 張' 或 '偏多操作'）"
}
      `;

      let key = process.env.API_KEY;
      if (!key) {
        throw new Error('API Key is not set. Please configure GEMINI_API_KEY or API_KEY in the Secrets panel.');
      }
      key = key.trim();

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('Gemini API Error:', JSON.stringify(errorData));
        
        const errorCode = errorData.error?.code;
        const errorMessage = errorData.error?.message || response.statusText;
        
        let friendlyMessage = 'AI 分析服務發生未知的錯誤，請稍後再試。';
        if (errorCode === 503) {
          friendlyMessage = '目前 Google AI 伺服器處於高負載狀態 (503)，這通常是暫時的，請稍等幾分鐘後再試一次。';
        } else if (errorCode === 429) {
          friendlyMessage = '已經達到免費 API 的請求頻率上限 (429)，請稍等 30 秒後再試。';
        } else if (errorCode === 400 && errorMessage.includes('API key not valid')) {
          friendlyMessage = 'API Key 無效，請檢查您的金鑰設定是否正確。';
        } else {
          friendlyMessage = `AI 服務錯誤: ${errorMessage}`;
        }
        
        return res.status(errorCode || 500).json({ error: friendlyMessage });
      }

      const data = await response.json();
      let text = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
      // Clean up markdown formatting if AI still includes it
      text = text.replace(/```json/g, '').replace(/```/g, '').trim();

      res.json({ analysis: JSON.parse(text) });
    } catch (error) {
      console.error('Error analyzing stock:', error);
      res.status(500).json({ error: 'Analysis failed' });
    }
  });

  // API: Trending/Recommendations
  app.get('/api/recommendations', async (req, res) => {
    try {
      // Default popular Taiwan stocks
      const symbols = ['2330.TW', '2317.TW', '2454.TW', '2308.TW', '2881.TW'];
      const results = [];
      const queryOptions = { lang: 'zh-Hant-TW', region: 'TW' };
      for (const sym of symbols) {
        try {
          const q = await yahooFinance.quote(sym, queryOptions) as any;
          if (q) results.push({ symbol: q.symbol, name: q.shortName || q.longName || sym });
        } catch (e) {
          results.push({ symbol: sym, name: sym });
        }
      }
      res.json({ recommendations: results });
    } catch (error) {
      console.error('Error fetching recommendations:', error);
      res.status(500).json({ error: 'Failed to fetch recommendations' });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
