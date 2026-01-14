const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Config
const CONFIG = {
    OPINION_API: 'https://openapi.opinion.trade/openapi',
    OPINION_KEY: '48b64b24dedae262c0c45a8e826eafd554a0',
    PROBABLE_API: 'https://market-api.probable.markets'
};

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Cache
let cache = {
    opinionMarkets: { data: null, timestamp: 0 },
    probableMarkets: { data: null, timestamp: 0 },
    probablePrices: { data: null, timestamp: 0 }
};

const CACHE_TTL = 60000; // 1 minute

// Helper: Check cache
function isCacheValid(key) {
    return cache[key].data && (Date.now() - cache[key].timestamp < CACHE_TTL);
}

// API: Get Opinion Markets
app.get('/api/opinion/markets', async (req, res) => {
    try {
        if (isCacheValid('opinionMarkets')) {
            return res.json(cache.opinionMarkets.data);
        }

        const response = await fetch(
            `${CONFIG.OPINION_API}/market?status=activated&limit=50&sortBy=5`,
            {
                headers: {
                    'apikey': CONFIG.OPINION_KEY,
                    'Accept': 'application/json'
                }
            }
        );

        if (!response.ok) {
            throw new Error(`Opinion API error: ${response.status}`);
        }

        const data = await response.json();
        
        cache.opinionMarkets = { data, timestamp: Date.now() };
        res.json(data);
    } catch (error) {
        console.error('Opinion markets error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// API: Get Opinion Token Price
app.get('/api/opinion/price/:tokenId', async (req, res) => {
    try {
        const { tokenId } = req.params;
        
        const response = await fetch(
            `${CONFIG.OPINION_API}/token/latest-price?token_id=${tokenId}`,
            {
                headers: {
                    'apikey': CONFIG.OPINION_KEY,
                    'Accept': 'application/json'
                }
            }
        );

        if (!response.ok) {
            throw new Error(`Opinion price API error: ${response.status}`);
        }

        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error('Opinion price error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// API: Get Probable Markets
app.get('/api/probable/markets', async (req, res) => {
    try {
        if (isCacheValid('probableMarkets')) {
            return res.json(cache.probableMarkets.data);
        }

        const response = await fetch(
            `${CONFIG.PROBABLE_API}/events?closed=false&sort=volume&order=desc&limit=100`,
            {
                headers: {
                    'Accept': 'application/json'
                }
            }
        );

        if (!response.ok) {
            throw new Error(`Probable API error: ${response.status}`);
        }

        const data = await response.json();
        
        cache.probableMarkets = { data, timestamp: Date.now() };
        res.json(data);
    } catch (error) {
        console.error('Probable markets error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// API: Get Probable Prices
app.get('/api/probable/prices', async (req, res) => {
    try {
        if (isCacheValid('probablePrices')) {
            return res.json(cache.probablePrices.data);
        }

        const response = await fetch(
            `${CONFIG.PROBABLE_API}/prices`,
            {
                headers: {
                    'Accept': 'application/json'
                }
            }
        );

        if (!response.ok) {
            throw new Error(`Probable prices API error: ${response.status}`);
        }

        const data = await response.json();
        
        cache.probablePrices = { data, timestamp: Date.now() };
        res.json(data);
    } catch (error) {
        console.error('Probable prices error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// API: Get all data for arbitrage scanning
app.get('/api/scan', async (req, res) => {
    try {
        // Fetch all data in parallel
        const [opinionRes, probableRes, pricesRes] = await Promise.all([
            fetch(`${CONFIG.OPINION_API}/market?status=activated&limit=50&sortBy=5`, {
                headers: { 'apikey': CONFIG.OPINION_KEY, 'Accept': 'application/json' }
            }),
            fetch(`${CONFIG.PROBABLE_API}/events?closed=false&sort=volume&order=desc&limit=100`, {
                headers: { 'Accept': 'application/json' }
            }),
            fetch(`${CONFIG.PROBABLE_API}/prices`, {
                headers: { 'Accept': 'application/json' }
            })
        ]);

        const opinionData = await opinionRes.json();
        const probableData = await probableRes.json();
        const pricesData = await pricesRes.json();

        // Process Opinion markets
        const opinionMarkets = opinionData.result?.list || [];

        // Process Probable markets with prices
        const probableMarkets = [];
        if (Array.isArray(probableData)) {
            probableData.forEach(event => {
                if (event.markets && Array.isArray(event.markets)) {
                    event.markets.forEach(market => {
                        if (market.active && !market.closed) {
                            // Attach prices
                            if (market.tokens) {
                                market.tokens.forEach(token => {
                                    if (pricesData[token.token_id]) {
                                        token.price = pricesData[token.token_id];
                                    }
                                });
                            }
                            probableMarkets.push({
                                ...market,
                                eventTitle: event.title,
                                eventSlug: event.slug,
                                eventTags: event.tags || []
                            });
                        }
                    });
                }
            });
        }

        res.json({
            success: true,
            timestamp: Date.now(),
            opinion: {
                count: opinionMarkets.length,
                markets: opinionMarkets
            },
            probable: {
                count: probableMarkets.length,
                markets: probableMarkets
            }
        });
    } catch (error) {
        console.error('Scan error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: Date.now() });
});

// Serve frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Arbitrage Scanner running on port ${PORT}`);
    console.log(`📊 Opinion API: ${CONFIG.OPINION_API}`);
    console.log(`📊 Probable API: ${CONFIG.PROBABLE_API}`);
});
