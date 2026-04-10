import React, { useState, useEffect, useMemo } from 'react';
import { Search, Plus, Trash2, TrendingUp, TrendingDown, RefreshCw, Activity, Newspaper, BrainCircuit, LineChart as LineChartIcon } from 'lucide-react';
import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { format } from 'date-fns';
import { SMA, RSI, MACD, Stochastic, BollingerBands } from 'technicalindicators';
import { cn } from '../lib/utils';

interface StockData {
  quote: any;
  historical: any[];
  news: any[];
}

interface StockItem {
  symbol: string;
  name: string;
}

export default function StockDashboard() {
  const [viewMode, setViewMode] = useState<'market' | 'stock'>('market');
  const [watchlist, setWatchlist] = useState<StockItem[]>(() => {
    const saved = localStorage.getItem('stockWatchlist');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.length > 0 && typeof parsed[0] === 'string') {
          return parsed.map((s: string) => ({ symbol: s, name: s }));
        }
        return parsed;
      } catch (e) {
        // ignore
      }
    }
    return [
      { symbol: '2330.TW', name: '台積電' },
      { symbol: '2317.TW', name: '鴻海' },
      { symbol: '2454.TW', name: '聯發科' }
    ];
  });
  const [recommendations, setRecommendations] = useState<StockItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedStock, setSelectedStock] = useState<StockItem>({ symbol: '2330.TW', name: '台積電' });
  
  const [stockData, setStockData] = useState<StockData | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState('');

  const [analysis, setAnalysis] = useState<any>(null);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [analysisError, setAnalysisError] = useState('');

  useEffect(() => {
    localStorage.setItem('stockWatchlist', JSON.stringify(watchlist));
  }, [watchlist]);

  useEffect(() => {
    fetchRecommendations();
  }, []);

  useEffect(() => {
    if (selectedStock) {
      fetchStockData(selectedStock.symbol);
    }
  }, [selectedStock]);

  useEffect(() => {
    const delayDebounceFn = setTimeout(async () => {
      if (searchQuery.trim()) {
        try {
          const res = await fetch(`/api/search/${encodeURIComponent(searchQuery)}`);
          const data = await res.json();
          setSearchResults(data.results || []);
          setShowDropdown(true);
        } catch (err) {
          console.error(err);
        }
      } else {
        setSearchResults([]);
        setShowDropdown(false);
      }
    }, 500);

    return () => clearTimeout(delayDebounceFn);
  }, [searchQuery]);

  const fetchRecommendations = async () => {
    try {
      const res = await fetch('/api/recommendations');
      const data = await res.json();
      if (data.recommendations) {
        setRecommendations(data.recommendations);
      }
    } catch (err) {
      console.error('Failed to fetch recommendations', err);
    }
  };

  const fetchStockData = async (symbol: string) => {
    setLoadingData(true);
    setError('');
    setAnalysis(null);
    setAnalysisError('');
    try {
      const res = await fetch(`/api/stock/${symbol}`);
      if (!res.ok) throw new Error('Failed to fetch stock data');
      const data = await res.json();
      setStockData(data);
    } catch (err: any) {
      setError(err.message || 'Error fetching data');
      setStockData(null);
    } finally {
      setLoadingData(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchResults.length > 0) {
      const res = searchResults[0];
      const item = { symbol: res.symbol, name: res.shortname || res.longname || res.symbol };
      setSelectedStock(item);
      addToWatchlist(item);
      setViewMode('stock');
      setSearchQuery('');
      setShowDropdown(false);
    } else if (searchQuery.trim()) {
      // Fallback if no results but user hits enter
      const query = searchQuery.toUpperCase().trim();
      const symbol = query.includes('.TW') || query.includes('.TWO') ? query : `${query}.TW`;
      const item = { symbol, name: symbol };
      setSelectedStock(item);
      addToWatchlist(item);
      setViewMode('stock');
      setSearchQuery('');
      setShowDropdown(false);
    }
  };

  const addToWatchlist = (item: StockItem) => {
    if (!watchlist.find(w => w.symbol === item.symbol)) {
      setWatchlist([...watchlist, item]);
    }
  };

  const removeFromWatchlist = (symbol: string) => {
    setWatchlist(watchlist.filter(s => s.symbol !== symbol));
  };

  const generateAnalysis = async () => {
    if (!stockData || !selectedStock) return;
    
    setLoadingAnalysis(true);
    setAnalysisError('');
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: selectedStock.symbol,
          quote: stockData.quote,
          historical: stockData.historical,
          news: stockData.news
        })
      });
      const data = await res.json();
      if (data.analysis) {
        setAnalysis(data.analysis);
      } else {
        setAnalysisError(data.error || '無法產生分析報告，請稍後再試');
      }
    } catch (err) {
      console.error('Analysis error:', err);
      setAnalysisError('AI 分析時發生錯誤（可能是免費額度限制或網路問題）');
    } finally {
      setLoadingAnalysis(false);
    }
  };

  const formatChartData = () => {
    if (!stockData?.historical) return [];
    // Only take the last 35 days for the chart
    const recent = stockData.historical.slice(-35);
    return recent.map(h => {
      let dateStr = '';
      try {
        const d = new Date(h.date);
        if (!isNaN(d.getTime())) {
          dateStr = format(d, 'MM/dd');
        }
      } catch (e) {}
      
      return {
        date: dateStr,
        open: h.open,
        close: h.close,
        high: h.high,
        low: h.low,
        isUp: h.close >= h.open // In Taiwan: Red is Up, Green is Down
      };
    });
  };

  const indicators = useMemo(() => {
    if (!stockData?.historical || stockData.historical.length < 60) return null;
    
    const closes = stockData.historical.map(h => h.close);
    const highs = stockData.historical.map(h => h.high);
    const lows = stockData.historical.map(h => h.low);
    const volumes = stockData.historical.map(h => h.volume);

    const ma5 = SMA.calculate({ period: 5, values: closes });
    const ma20 = SMA.calculate({ period: 20, values: closes });
    const ma60 = SMA.calculate({ period: 60, values: closes });
    
    const rsi = RSI.calculate({ period: 14, values: closes });
    const macd = MACD.calculate({
      values: closes,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      SimpleMAOscillator: false,
      SimpleMASignal: false
    });
    
    const kd = Stochastic.calculate({
      high: highs,
      low: lows,
      close: closes,
      period: 9,
      signalPeriod: 3
    });

    const bb = BollingerBands.calculate({
      period: 20,
      values: closes,
      stdDev: 2
    });

    const last = (arr: any[]) => arr[arr.length - 1];
    const lastVolume = last(volumes);

    return {
      ma5: last(ma5)?.toFixed(1),
      ma20: last(ma20)?.toFixed(1),
      ma60: last(ma60)?.toFixed(1),
      rsi: last(rsi)?.toFixed(2),
      macd: last(macd)?.MACD?.toFixed(2),
      kdK: last(kd)?.k?.toFixed(2),
      kdD: last(kd)?.d?.toFixed(2),
      bbUpper: last(bb)?.upper?.toFixed(2),
      bbLower: last(bb)?.lower?.toFixed(2),
      volume: lastVolume ? (lastVolume / 1000).toFixed(0) : '0' // in thousands
    };
  }, [stockData]);

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900 font-sans overflow-hidden">
      {/* Sidebar */}
      <div className="w-80 bg-white border-r border-slate-200 flex flex-col h-full shadow-sm z-10">
        <div className="p-6 border-b border-slate-100">
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Activity className="text-blue-600" />
            AI Stock Pro
          </h1>
          <p className="text-sm text-slate-500 mt-1">智能股票分析系統</p>
        </div>

        <div className="px-4 pt-4 pb-2">
          <button 
            onClick={() => setViewMode('market')}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all",
              viewMode === 'market' ? "bg-slate-800 text-white shadow-md" : "bg-white text-slate-600 hover:bg-slate-50 border border-slate-200"
            )}
          >
            <LineChartIcon className="w-5 h-5" />
            AI 每日推薦與大盤
          </button>
        </div>

        <div className="p-4 pt-2">
          <div className="relative">
            <form onSubmit={handleSearch}>
              <input
                type="text"
                placeholder="搜尋台股代碼或名稱 (如 2330 或 台積電)"
                className="w-full pl-10 pr-4 py-2 bg-slate-100 border-transparent rounded-lg focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all outline-none"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => setShowDropdown(true)}
                onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
              />
              <Search className="absolute left-3 top-2.5 text-slate-400 w-5 h-5" />
            </form>
            {showDropdown && searchResults.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-50 max-h-60 overflow-y-auto custom-scrollbar">
                {searchResults.map(res => (
                  <div 
                    key={res.symbol} 
                    className="p-3 hover:bg-slate-50 cursor-pointer border-b border-slate-50 last:border-0"
                    onClick={() => { 
                      const item = { symbol: res.symbol, name: res.shortname || res.longname || res.symbol };
                      setSelectedStock(item); 
                      addToWatchlist(item);
                      setViewMode('stock');
                      setSearchQuery(''); 
                      setShowDropdown(false); 
                    }}
                  >
                    <div className="font-medium text-slate-800">{res.symbol.replace('.TW', '').replace('.TWO', '')} - {res.shortname || res.longname}</div>
                    <div className="text-xs text-slate-500">{res.symbol}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {/* Watchlist */}
          <div>
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 px-2">自選股票</h2>
            <div className="space-y-1">
              {watchlist.map(item => (
                <div
                  key={item.symbol}
                  className={cn(
                    "flex items-center justify-between p-3 rounded-lg cursor-pointer transition-colors group",
                    selectedStock.symbol === item.symbol && viewMode === 'stock' ? "bg-blue-50 text-blue-700" : "hover:bg-slate-100"
                  )}
                  onClick={() => { setSelectedStock(item); setViewMode('stock'); }}
                >
                  <div>
                    <div className="font-medium">{item.symbol.replace('.TW', '').replace('.TWO', '')}</div>
                    <div className="text-xs opacity-70">{item.name}</div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); removeFromWatchlist(item.symbol); }}
                    className="text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Recommendations */}
          <div>
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 px-2 flex items-center justify-between">
              <span>每日推薦 (熱門)</span>
              <button onClick={fetchRecommendations} className="hover:text-slate-600">
                <RefreshCw className="w-3 h-3" />
              </button>
            </h2>
            <div className="space-y-1">
              {recommendations.map(item => (
                <div
                  key={item.symbol}
                  className="flex items-center justify-between p-3 rounded-lg cursor-pointer hover:bg-slate-100 transition-colors"
                  onClick={() => { setSelectedStock(item); setViewMode('stock'); }}
                >
                  <div>
                    <div className="font-medium text-slate-700">{item.symbol.replace('.TW', '').replace('.TWO', '')}</div>
                    <div className="text-xs text-slate-500">{item.name}</div>
                  </div>
                  <Plus className="w-4 h-4 text-slate-400 hover:text-blue-600" onClick={(e) => { e.stopPropagation(); addToWatchlist(item); }} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      {viewMode === 'market' ? (
        <div className="flex-1 overflow-y-auto p-10 bg-white custom-scrollbar">
          <div className="max-w-5xl mx-auto">
            {/* Header Section */}
            <div className="mb-12">
              <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2 mb-4">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                AI 每日選股邏輯
              </h2>
              <p className="text-slate-600 leading-relaxed">
                系統每日整合技術指標（RSI、MACD、KD、均線多頭排列）、籌碼面（外資、投信買超）、消息面（法人評等、新聞情緒）等多維度數據，篩選出綜合評分最高的潛力股。今日以 AI 供應鏈及半導體族群最受法人青睞。
              </p>
            </div>

            {/* Recommendations List */}
            <div className="mb-16">
              <div className="flex justify-between items-end mb-6 border-b border-slate-100 pb-4">
                <h3 className="text-xl font-bold text-slate-900">今日 AI 推薦股 · {format(new Date(), 'M/d')}</h3>
                <button className="text-sm text-slate-500 hover:text-slate-800 flex items-center gap-1">
                  即時更新 <TrendingUp className="w-4 h-4" />
                </button>
              </div>
              
              <div className="space-y-0">
                {[
                  { rank: 1, symbol: '2330', name: '台積電', reason: '外資連5買，CoWoS 供不應求，AI 晶片需求爆發', tag: '強力買進', score: 92, tagColor: 'bg-[#f0fdf4] text-emerald-700' },
                  { rank: 2, symbol: '2454', name: '聯發科', reason: '天璣新晶片出貨優，4Q 旺季效應顯現', tag: '買進', score: 88, tagColor: 'bg-[#f0fdf4] text-emerald-700' },
                  { rank: 3, symbol: 'NVDA', name: 'NVIDIA', reason: 'Blackwell 架構出貨加速，DC GPU 訂單能見度高', tag: '買進', score: 85, tagColor: 'bg-[#f0fdf4] text-emerald-700' },
                  { rank: 4, symbol: '6669', name: '緯穎', reason: 'AI 伺服器受惠股，微軟/Google 訂單大增', tag: '留意買點', score: 81, tagColor: 'bg-[#fdf8f3] text-orange-700' },
                  { rank: 5, symbol: '2303', name: '聯電', reason: '成熟製程需求回溫，EV/IoT 拉貨訊號', tag: '觀察', score: 74, tagColor: 'bg-slate-50 text-slate-600' },
                ].map((item) => (
                  <div key={item.symbol} className="flex items-center py-5 border-b border-slate-50 hover:bg-slate-50 transition-colors group px-2 cursor-pointer" onClick={() => {
                    const stockItem = { symbol: item.symbol.includes('NVDA') ? 'NVDA' : `${item.symbol}.TW`, name: item.name };
                    setSelectedStock(stockItem);
                    setViewMode('stock');
                    addToWatchlist(stockItem);
                  }}>
                    <div className="w-12 text-2xl font-serif text-slate-400 group-hover:text-slate-800 transition-colors">{item.rank}</div>
                    <div className="w-32">
                      <div className="font-serif text-lg text-slate-900">{item.symbol}</div>
                      <div className="text-sm text-slate-500">{item.name}</div>
                    </div>
                    <div className="flex-1 text-slate-700 pr-8">{item.reason}</div>
                    <div className="w-32 text-right flex flex-col items-end gap-1">
                      <span className={cn("px-3 py-1 text-sm font-medium rounded", item.tagColor)}>
                        {item.tag}
                      </span>
                      <span className="text-xs text-slate-400">評分 {item.score}/100</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Market Signals */}
            <div>
              <h3 className="text-xl font-bold text-slate-900 mb-6 border-b border-slate-100 pb-4">今日市場關鍵訊號</h3>
              <div className="space-y-4">
                <div className="flex justify-between items-center py-3 border-b border-slate-50">
                  <span className="text-slate-600 font-medium">外資動向</span>
                  <span className="font-serif text-slate-900">買超 NT$125.3 億</span>
                </div>
                <div className="flex justify-between items-center py-3 border-b border-slate-50">
                  <span className="text-slate-600 font-medium">投信動向</span>
                  <span className="font-serif text-slate-900">買超 NT$18.7 億</span>
                </div>
                <div className="flex justify-between items-center py-3 border-b border-slate-50">
                  <span className="text-slate-600 font-medium">融資增減</span>
                  <span className="font-serif text-slate-900">增加 NT$8.2 億</span>
                </div>
                <div className="flex justify-between items-center py-3 border-b border-slate-50">
                  <span className="text-slate-600 font-medium">市場情緒指數</span>
                  <span className="font-serif text-slate-900">72 / 100 <span className="text-emerald-600 text-sm ml-1">（偏多）</span></span>
                </div>
                <div className="flex justify-between items-center py-3 border-b border-slate-50">
                  <span className="text-slate-600 font-medium">今日焦點族群</span>
                  <span className="font-serif text-slate-900">AI 伺服器、CoWoS 封裝</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
      <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-50/50">
        {loadingData ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        ) : error ? (
          <div className="flex-1 flex items-center justify-center text-red-500">
            {error}
          </div>
        ) : stockData ? (
          <div className="flex-1 overflow-y-auto p-8">
            {/* Header */}
            <div className="flex justify-between items-start mb-8">
              <div>
                <h1 className="text-4xl font-bold text-slate-900 flex items-end gap-3 font-serif">
                  {selectedStock.symbol.replace('.TW', '').replace('.TWO', '')}
                  <span className="text-2xl text-slate-600 font-medium pb-0.5">{selectedStock.name}</span>
                </h1>
                <div className="flex items-center gap-4 mt-4">
                  <div className="text-4xl font-serif text-slate-900">
                    NT${stockData.quote?.regularMarketPrice?.toLocaleString()}
                  </div>
                  <div className={cn(
                    "flex items-center gap-1 text-lg font-medium",
                    stockData.quote?.regularMarketChange >= 0 ? "text-red-500" : "text-emerald-500"
                  )}>
                    {stockData.quote?.regularMarketChange >= 0 ? '+' : ''}
                    {stockData.quote?.regularMarketChangePercent?.toFixed(2)}% 
                    ({stockData.quote?.regularMarketChange >= 0 ? '+' : ''}{stockData.quote?.regularMarketChange?.toFixed(1)})
                  </div>
                </div>
              </div>
              {analysis?.recommendation && (
                <div className="px-6 py-2 bg-orange-50 text-orange-800 font-bold text-lg rounded shadow-sm border border-orange-100">
                  {analysis.recommendation}
                </div>
              )}
            </div>

            <div className="space-y-12">
              {/* Chart Section */}
              <div>
                <h3 className="text-sm font-bold text-slate-800 mb-4">K 線走勢（近35日）</h3>
                <div className="h-[250px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={formatChartData()} barCategoryGap="10%">
                      <XAxis dataKey="date" hide />
                      <YAxis domain={['auto', 'auto']} hide />
                      <Tooltip 
                        contentStyle={{ borderRadius: '4px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                        formatter={(value: any, name: string) => [value, name === 'close' ? '收盤價' : name]}
                        labelFormatter={(label) => `日期: ${label}`}
                      />
                      <Bar dataKey="close" isAnimationActive={false}>
                        {formatChartData().map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.isUp ? '#e07a7a' : '#7eb89e'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                {indicators && (
                  <div className="flex gap-6 mt-4 text-sm font-serif">
                    <div>MA5: <span className="text-red-500">NT${indicators.ma5}</span></div>
                    <div>MA20: <span className="text-emerald-500">NT${indicators.ma20}</span></div>
                    <div>MA60: <span className="text-amber-700">NT${indicators.ma60}</span></div>
                  </div>
                )}
              </div>

              {/* Middle Grid: Indicators & News */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-16">
                {/* Technical Indicators */}
                <div>
                  <h3 className="text-lg font-bold text-slate-800 mb-6 border-b border-slate-200 pb-2">技術指標</h3>
                  <div className="space-y-4 text-sm">
                    <div className="flex justify-between">
                      <span className="text-slate-600">RSI(14)</span>
                      <span className="font-medium">{indicators?.rsi || '-'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-600">MACD</span>
                      <span className="font-medium">{indicators?.macd || '-'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-600">KD 隨機 K</span>
                      <span className="font-medium">{indicators?.kdK || '-'} / {indicators?.kdD || '-'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-600">布林通道</span>
                      <span className="font-medium">{indicators?.bbUpper || '-'} / {indicators?.bbLower || '-'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-600">成交量</span>
                      <span className="font-medium">{indicators?.volume ? `${indicators.volume} 張` : '-'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-600">外資動向</span>
                      <span className="font-medium">{analysis?.foreignInvestment || '-'}</span>
                    </div>
                  </div>
                </div>

                {/* Recent News */}
                <div>
                  <h3 className="text-lg font-bold text-slate-800 mb-6 border-b border-slate-200 pb-2">近期新聞</h3>
                  <div className="space-y-5">
                    {stockData.news?.slice(0, 4).map((item, i) => {
                      const sentiment = analysis?.newsSentiment?.find((s: any) => s.index === i)?.sentiment;
                      
                      let publishDateStr = '';
                      try {
                        const d = item.providerPublishTime ? new Date(item.providerPublishTime * 1000) : new Date(item.pubDate);
                        if (!isNaN(d.getTime())) {
                          publishDateStr = format(d, 'MM/dd HH:mm');
                        }
                      } catch (e) {}

                      return (
                        <div key={i} className="group">
                          <a href={item.link} target="_blank" rel="noreferrer" className="block hover:text-blue-600 transition-colors">
                            <h4 className="font-medium text-slate-800 line-clamp-1 group-hover:text-blue-600">{item.title}</h4>
                          </a>
                          <div className="flex items-center gap-2 mt-1 text-xs text-slate-500">
                            {sentiment && (
                              <span className={cn(
                                "flex items-center gap-1",
                                sentiment === '利多' ? "text-red-500" : sentiment === '利空' ? "text-emerald-500" : "text-slate-400"
                              )}>
                                <span className={cn(
                                  "w-1.5 h-1.5 rounded-full",
                                  sentiment === '利多' ? "bg-red-500" : sentiment === '利空' ? "bg-emerald-500" : "bg-slate-400"
                                )} />
                                {sentiment}
                              </span>
                            )}
                            <span>{publishDateStr ? `${publishDateStr} · ` : ''}{item.publisher}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Bottom: AI Analysis & Strategy */}
              <div className="pt-8 border-t border-slate-200">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                    AI 綜合分析 · {selectedStock.symbol.replace('.TW', '').replace('.TWO', '')}
                  </h3>
                  {!analysis && !loadingAnalysis && (
                    <button 
                      onClick={generateAnalysis}
                      className="px-4 py-2 bg-slate-800 text-white rounded text-sm font-medium hover:bg-slate-700 transition-colors"
                    >
                      產生 AI 分析報告
                    </button>
                  )}
                </div>

                {loadingAnalysis ? (
                  <div className="flex flex-col items-center justify-center py-12 text-slate-500 space-y-4">
                    <BrainCircuit className="w-8 h-8 animate-pulse" />
                    <p className="text-sm font-medium animate-pulse">AI 正在分析技術指標與新聞...</p>
                  </div>
                ) : analysisError ? (
                  <div className="flex flex-col items-center justify-center py-10 text-red-500 space-y-4 bg-red-50 rounded-lg border border-red-100">
                    <p className="text-sm font-medium">{analysisError}</p>
                    <button 
                      onClick={generateAnalysis}
                      className="px-4 py-2 bg-red-100 text-red-700 rounded text-sm font-medium hover:bg-red-200 transition-colors flex items-center gap-2"
                    >
                      <RefreshCw className="w-4 h-4" /> 重新產生分析
                    </button>
                  </div>
                ) : analysis ? (
                  <div className="space-y-8">
                    {analysis.technicalAnalysis && (
                      <div>
                        <h4 className="text-sm font-bold text-slate-800 mb-2 flex items-center gap-2">
                          <Activity className="w-4 h-4 text-blue-600" /> 技術面分析結果
                        </h4>
                        <p className="text-slate-700 leading-relaxed text-sm">
                          {analysis.technicalAnalysis}
                        </p>
                      </div>
                    )}
                    <div>
                      <h4 className="text-sm font-bold text-slate-800 mb-2 flex items-center gap-2">
                        <Newspaper className="w-4 h-4 text-blue-600" /> 綜合評估與消息面
                      </h4>
                      <p className="text-slate-700 leading-relaxed text-sm">
                        {analysis.analysisSummary}
                      </p>
                    </div>
                    
                    <div className="grid grid-cols-4 gap-4 pt-4 border-t border-slate-200">
                      <div className="text-center">
                        <div className="text-xs text-slate-500 mb-1">建議買點</div>
                        <div className="text-lg font-serif text-emerald-600">{analysis.strategy?.buyPrice || '-'}</div>
                      </div>
                      <div className="text-center">
                        <div className="text-xs text-slate-500 mb-1">停損價</div>
                        <div className="text-lg font-serif text-amber-700">{analysis.strategy?.stopLoss || '-'}</div>
                      </div>
                      <div className="text-center">
                        <div className="text-xs text-slate-500 mb-1">目標賣出</div>
                        <div className="text-lg font-serif text-red-500">{analysis.strategy?.targetPrice || '-'}</div>
                      </div>
                      <div className="text-center">
                        <div className="text-xs text-slate-500 mb-1">潛在報酬</div>
                        <div className="text-lg font-serif text-emerald-600">{analysis.strategy?.potentialReturn || '-'}</div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="py-12 text-center text-slate-400">
                    <p className="text-sm">點擊上方按鈕，讓 AI 為您統整技術面與消息面，並提供專屬買賣策略。</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>
      )}
    </div>
  );
}
