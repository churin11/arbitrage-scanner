const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

// Config
const CONFIG = {
    OPINION_API: 'https://openapi.opinion.trade/openapi',
    OPINION_KEY: '48b64b24dedae262c0c45a8e826eafd554a0',
    PROBABLE_API: 'https://api.probable.ag/v1'
};

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Cache
let cache = {
    opinionMarkets: { data: null, timestamp: 0 },
    probableMarkets: { data: null, timestamp: 0 }
};

const CACHE_TTL = 60000;

function isCacheValid(key) {
    return cache[key].data && (Date.now() - cache[key].timestamp < CACHE_TTL);
}

// Fetch with timeout
async function fetchWithTimeout(url, options = {}, timeout = 10000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    
    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        clearTimeout(id);
        return response;
    } catch (error) {
        clearTimeout(id);
        throw error;
    }
}

// API: Get Opinion Markets
app.get('/api/opinion/markets', async (req, res) => {
    try {
        if (isCacheValid('opinionMarkets')) {
            return res.json(cache.opinionMarkets.data);
        }

        const response = await fetchWithTimeout(
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
        
        const response = await fetchWithTimeout(
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

        const response = await fetchWithTimeout(
            `${CONFIG.PROBABLE_API}/markets?status=open&limit=100`,
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

// API: Get all data for arbitrage scanning
app.get('/api/scan', async (req, res) => {
    try {
        console.log('Starting scan...');
        
        // Fetch Opinion markets
        let opinionMarkets = [];
        try {
            const opinionRes = await fetchWithTimeout(
                `${CONFIG.OPINION_API}/market?status=activated&limit=50&sortBy=5`,
                {
                    headers: { 
                        'apikey': CONFIG.OPINION_KEY, 
                        'Accept': 'application/json' 
                    }
                }
            );
            
            if (opinionRes.ok) {
                const opinionData = await opinionRes.json();
                opinionMarkets = opinionData.result?.list || [];
                console.log(`Opinion: ${opinionMarkets.length} markets`);
            }
        } catch (e) {
            console.error('Opinion fetch failed:', e.message);
        }

        // Fetch Probable markets
        let probableMarkets = [];
        try {
            const probableRes = await fetchWithTimeout(
                `${CONFIG.PROBABLE_API}/markets?status=open&limit=100`,
                {
                    headers: { 'Accept': 'application/json' }
                }
            );
            
            if (probableRes.ok) {
                const text = await probableRes.text();
                // Check if response is JSON
                if (text.startsWith('{') || text.startsWith('[')) {
                    const probableData = JSON.parse(text);
                    if (Array.isArray(probableData)) {
                        probableMarkets = probableData;
                    } else if (probableData.markets) {
                        probableMarkets = probableData.markets;
                    } else if (probableData.data) {
                        probableMarkets = probableData.data;
                    }
                }
                console.log(`Probable: ${probableMarkets.length} markets`);
            }
        } catch (e) {
            console.error('Probable fetch failed:', e.message);
        }

        // Return whatever we got
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
