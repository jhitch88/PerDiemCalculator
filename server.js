const express = require('express');
const session = require('express-session');
const axios = require('axios');
const path = require('path');
const crypto = require('crypto');
const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");

// Load environment variables from .env file in development
if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const app = express();
const PORT = process.env.PORT || 3002;
const NODE_ENV = process.env.NODE_ENV || 'development';

// GSA API Configuration
const GSA_BASE_URL = 'https://api.gsa.gov/travel/perdiem/v2';

// Global variables for secrets (will be loaded from AWS Secrets Manager in production)
let GSA_API_KEY, LOGIN_USERNAME, LOGIN_PASSWORD, SESSION_SECRET;

// Function to get secrets from AWS Secrets Manager
async function getSecrets() {
    if (NODE_ENV !== 'production') {
        // In development, use environment variables
        GSA_API_KEY = process.env.GSA_API_KEY;
        LOGIN_USERNAME = process.env.LOGIN_USERNAME;
        LOGIN_PASSWORD = process.env.LOGIN_PASSWORD;
        SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(64).toString('hex');
        console.log('Using environment variables for development');
        return;
    }

    try {
        console.log('Loading secrets from AWS Secrets Manager...');
        const secret_name = "PerDiemSecrets";
        
        const client = new SecretsManagerClient({
            region: "us-east-1",
        });
        
        const response = await client.send(
            new GetSecretValueCommand({
                SecretId: secret_name,
                VersionStage: "AWSCURRENT", // VersionStage defaults to AWSCURRENT if unspecified
            })
        );
        
        const secrets = JSON.parse(response.SecretString);
        
        GSA_API_KEY = secrets.GSA_API_KEY;
        LOGIN_USERNAME = secrets.LOGIN_USERNAME;
        LOGIN_PASSWORD = secrets.LOGIN_PASSWORD;
        SESSION_SECRET = secrets.SESSION_SECRET;
        
        console.log('✅ Secrets loaded successfully from AWS Secrets Manager');
        console.log(`✅ GSA_API_KEY loaded: ${GSA_API_KEY ? 'Yes' : 'No'}`);
        console.log(`✅ LOGIN_USERNAME loaded: ${LOGIN_USERNAME ? 'Yes' : 'No'}`);
        console.log(`✅ LOGIN_PASSWORD loaded: ${LOGIN_PASSWORD ? 'Yes' : 'No'}`);
        console.log(`✅ SESSION_SECRET loaded: ${SESSION_SECRET ? 'Yes' : 'No'}`);
        
    } catch (error) {
        console.error('❌ Error loading secrets from AWS Secrets Manager:', error.message);
        console.error('❌ Error details:', error);
        
        // Fallback to environment variables
        console.log('⚠️ Falling back to environment variables...');
        GSA_API_KEY = process.env.GSA_API_KEY;
        LOGIN_USERNAME = process.env.LOGIN_USERNAME;
        LOGIN_PASSWORD = process.env.LOGIN_PASSWORD;
        SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(64).toString('hex');
        
        if (!GSA_API_KEY) {
            console.error('❌ CRITICAL: No GSA_API_KEY found in Secrets Manager or environment variables');
        }
    }
}

// Initialize and start server
async function startServer() {
    await getSecrets();
    
    // Validate required secrets
    if (!GSA_API_KEY) {
        console.error('ERROR: GSA_API_KEY is required');
        process.exit(1);
    }

    if (!LOGIN_USERNAME || !LOGIN_PASSWORD) {
        console.error('ERROR: LOGIN_USERNAME and LOGIN_PASSWORD are required');
        process.exit(1);
    }

    console.log(`Starting Per Diem Calculator in ${NODE_ENV} mode`);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Session configuration
app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: NODE_ENV === 'production', // HTTPS only in production
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        httpOnly: true,
        sameSite: NODE_ENV === 'production' ? 'strict' : 'lax'
    }
}));

// Authentication middleware
const requireAuth = (req, res, next) => {
    console.log('Auth check - Session:', req.session.authenticated, 'URL:', req.url);
    if (req.session.authenticated) {
        next();
    } else {
        console.log('Authentication failed, redirecting to login');
        // For API calls, return JSON instead of redirect
        if (req.url.startsWith('/api/')) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        res.redirect('/login');
    }
};

// Routes
app.get('/', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    console.log('Login attempt:', username);
    
    if (username === LOGIN_USERNAME && password === LOGIN_PASSWORD) {
        req.session.authenticated = true;
        console.log('Login successful, session set');
        res.json({ success: true });
    } else {
        console.log('Login failed - invalid credentials');
        res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
});

app.post('/logout', (req, res) => {
    console.log('Logout request received');
    req.session.destroy((err) => {
        if (err) {
            console.error('Session destroy error:', err);
            return res.status(500).json({ success: false, error: 'Logout failed' });
        }
        console.log('Session destroyed successfully');
        res.clearCookie('connect.sid'); // Clear the session cookie
        res.json({ success: true });
    });
});

// Auth check endpoint
app.get('/api/auth-check', requireAuth, (req, res) => {
    res.json({ authenticated: true });
});

// Helper function to get zip code from city/state using free geocoding
async function getCityZipCode(city, state) {
    try {
        console.log(`Attempting to get zip code for ${city}, ${state}`);
        
        // Use a reverse geocoding service to get zip code
        // Using free service from zippopotam.us
        const zipResponse = await axios.get(`http://api.zippopotam.us/us/${state}/${encodeURIComponent(city)}`, {
            timeout: 5000
        });
        
        if (zipResponse.data && zipResponse.data.places && zipResponse.data.places.length > 0) {
            const zipCode = zipResponse.data.places[0]['post code'];
            console.log(`Found zip code ${zipCode} for ${city}, ${state}`);
            return zipCode;
        }
        
        console.log(`No zip code found for ${city}, ${state}`);
        return null;
    } catch (error) {
        console.error('Geocoding error:', error.message);
        return null;
    }
}

// API endpoint to get per diem rates
app.post('/api/perdiem', requireAuth, async (req, res) => {
    try {
        const { city, state, date, zipCode } = req.body;
        console.log(`Per diem request: ${city}, ${state}, ${date}, zip: ${zipCode || 'none'}`);
        
        if (!city || !state || !date) {
            return res.status(400).json({ error: 'City, state, and date are required' });
        }

        // Format date for GSA API (YYYY-MM-DD)
        const formattedDate = new Date(date).toISOString().split('T')[0];
        const year = new Date(date).getFullYear();

        let perDiemResponse;
        let actualZipCode = zipCode;

        // Try to get zip code if not provided
        if (!actualZipCode) {
            console.log(`Attempting to get zip code for ${city}, ${state}`);
            actualZipCode = await getCityZipCode(city, state);
        }

        // First try with zip code if available
        if (actualZipCode) {
            try {
                console.log(`Trying GSA API with zip code: ${actualZipCode}`);
                console.log(`Full URL: ${GSA_BASE_URL}/rates/zip/${actualZipCode}/year/${year}`);
                console.log(`Using API Key: ${GSA_API_KEY.substring(0, 10)}...`);
                
                // Try the most common GSA API format first
                perDiemResponse = await axios.get(`${GSA_BASE_URL}/rates/zip/${actualZipCode}/year/${year}`, {
                    headers: {
                        'X-API-Key': GSA_API_KEY,
                        'Accept': 'application/json',
                        'User-Agent': 'PerDiemCalculator/1.0'
                    },
                    timeout: 10000
                });
                
                console.log('GSA API Response headers:', perDiemResponse.headers);
                console.log('GSA API Response status:', perDiemResponse.status);
                console.log('GSA API Response type:', typeof perDiemResponse.data);
                console.log('GSA API Response length:', JSON.stringify(perDiemResponse.data).length);
                
                // Check if we got HTML instead of JSON
                if (typeof perDiemResponse.data === 'string' && perDiemResponse.data.includes('<html')) {
                    console.log('ERROR: Received HTML response instead of JSON - API authentication may be failing');
                    console.log('HTML snippet:', perDiemResponse.data.substring(0, 200));
                    throw new Error('GSA API returned HTML instead of JSON - authentication issue');
                }
                
                console.log('GSA API Response structure:', JSON.stringify(perDiemResponse.data, null, 2));
                
                if (perDiemResponse.data && perDiemResponse.data.rates && perDiemResponse.data.rates.length > 0) {
                    const rate = perDiemResponse.data.rates[0];
                    console.log('Rate object:', JSON.stringify(rate, null, 2));
                    
                    // Parse the rate data - GSA API has complex nested structure
                    let lodging = 0, meals = 0, incidentals = 0;
                    
                    // Extract lodging, meals, and incidentals from the nested rate structure
                    if (rate.rate && rate.rate.length > 0) {
                        const rateData = rate.rate[0];
                        
                        // Extract meals and incidentals from the nested rate object
                        meals = rateData.meals || 0;
                        incidentals = rateData.incidentals || 0;
                        console.log(`Found meals: ${meals}, incidentals: ${incidentals} in nested rate structure`);
                        
                        // Extract lodging from the monthly data structure
                        if (rateData.months && rateData.months.month) {
                            // Find the month that matches our date
                            const targetMonth = new Date(formattedDate).getMonth() + 1; // getMonth() is 0-based
                            console.log(`Looking for month ${targetMonth} in lodging data`);
                            
                            const monthData = rateData.months.month.find(m => m.number === targetMonth);
                            if (monthData) {
                                lodging = monthData.value || 0;
                                console.log(`Found lodging rate for month ${targetMonth}: ${lodging}`);
                            } else {
                                // If specific month not found, use first month's rate
                                lodging = rateData.months.month[0]?.value || 0;
                                console.log(`Using first month's lodging rate: ${lodging}`);
                            }
                        }
                    }
                    
                    // Fallback: try to extract from top level if nested extraction failed
                    if (meals === 0) {
                        meals = rate.meals || 0;
                        console.log(`Fallback: extracted meals from top level: ${meals}`);
                    }
                    if (incidentals === 0) {
                        incidentals = rate.incidentals || 0;
                        console.log(`Fallback: extracted incidentals from top level: ${incidentals}`);
                    }
                    
                    console.log(`Final parsed rates - Lodging: ${lodging}, Meals: ${meals}, Incidentals: ${incidentals}`);
                    
                    if (lodging > 0 || meals > 0) { // At least one rate should be positive
                        return res.json({
                            success: true,
                            method: 'zipcode',
                            zipCode: actualZipCode,
                            data: {
                                city: rate.city || city,
                                state: rate.state || state,
                                county: rate.county || '',
                                lodging: lodging,
                                meals: meals,
                                incidentals: incidentals,
                                total: lodging + meals + incidentals,
                                effectiveDate: `${year}-01-01`,
                                expirationDate: `${year}-12-31`,
                                standardRate: rate.standardRate || 'false'
                            }
                        });
                    }
                }
            } catch (zipError) {
                console.log('Zip code lookup failed:', zipError.response?.status, zipError.response?.data || zipError.message);
                
                // Try alternative conus format
                try {
                    console.log(`Trying alternative conus format: ${actualZipCode}`);
                    perDiemResponse = await axios.get(`${GSA_BASE_URL}/rates/conus/zip/${actualZipCode}/year/${year}`, {
                        headers: {
                            'X-API-Key': GSA_API_KEY,
                            'Accept': 'application/json',
                            'User-Agent': 'PerDiemCalculator/1.0'
                        },
                        timeout: 10000
                    });
                    
                    console.log('Alternative API Response status:', perDiemResponse.status);
                    
                    // Check if we got HTML instead of JSON
                    if (typeof perDiemResponse.data === 'string' && perDiemResponse.data.includes('<html')) {
                        console.log('ERROR: Alternative API also returned HTML instead of JSON');
                        console.log('HTML snippet:', perDiemResponse.data.substring(0, 200));
                        throw new Error('Alternative GSA API also returned HTML');
                    }
                    
                    console.log('Alternative API Response:', JSON.stringify(perDiemResponse.data, null, 2));
                    
                    if (perDiemResponse.data && perDiemResponse.data.rates && perDiemResponse.data.rates.length > 0) {
                        const rate = perDiemResponse.data.rates[0];
                        let lodging = 0, meals = 0, incidentals = 0;
                        
                        // Extract from nested rate structure
                        if (rate.rate && rate.rate.length > 0) {
                            const rateData = rate.rate[0];
                            
                            // Extract meals and incidentals from nested structure
                            meals = rateData.meals || 0;
                            incidentals = rateData.incidentals || 0;
                            
                            // Extract lodging from monthly data
                            if (rateData.months && rateData.months.month) {
                                const targetMonth = new Date(formattedDate).getMonth() + 1;
                                const monthData = rateData.months.month.find(m => m.number === targetMonth);
                                lodging = monthData ? monthData.value : (rateData.months.month[0]?.value || 0);
                            }
                        }
                        
                        // Fallback to top level if nested extraction failed
                        if (meals === 0) {
                            meals = rate.meals || 0;
                        }
                        if (incidentals === 0) {
                            incidentals = rate.incidentals || 0;
                        }
                        
                        console.log(`Alternative parsed rates - Lodging: ${lodging}, Meals: ${meals}, Incidentals: ${incidentals}`);
                        
                        if (lodging > 0 || meals > 0) {
                            return res.json({
                                success: true,
                                method: 'zipcode_alt',
                                zipCode: actualZipCode,
                                data: {
                                    city: rate.city || city,
                                    state: rate.state || state,
                                    county: rate.county || '',
                                    lodging: lodging,
                                    meals: meals,
                                    incidentals: incidentals,
                                    total: lodging + meals + incidentals,
                                    effectiveDate: `${year}-01-01`,
                                    expirationDate: `${year}-12-31`
                                }
                            });
                        }
                    }
                } catch (altError) {
                    console.log('Alternative format also failed:', altError.response?.status, altError.response?.data || altError.message);
                }
            }
        }

        // Fallback to city name lookup
        try {
            console.log(`Trying GSA API with city name: ${city}, ${state}, year: ${year}`);
            perDiemResponse = await axios.get(`${GSA_BASE_URL}/rates/city/${encodeURIComponent(city)}/${state}/year/${year}`, {
                headers: {
                    'X-API-Key': GSA_API_KEY,
                    'Accept': 'application/json',
                    'User-Agent': 'PerDiemCalculator/1.0'
                },
                timeout: 10000
            });

            console.log('City API Response status:', perDiemResponse.status);
            
            // Check if we got HTML instead of JSON
            if (typeof perDiemResponse.data === 'string' && perDiemResponse.data.includes('<html')) {
                console.log('ERROR: City API returned HTML instead of JSON');
                console.log('HTML snippet:', perDiemResponse.data.substring(0, 200));
                throw new Error('City GSA API returned HTML');
            }

            console.log('City API Response:', JSON.stringify(perDiemResponse.data, null, 2));

            if (perDiemResponse.data && perDiemResponse.data.rates && perDiemResponse.data.rates.length > 0) {
                console.log(`GSA city lookup returned ${perDiemResponse.data.rates.length} rates`);
                
                // Find the rate that applies to the given date (important for monthly changes)
                const targetDate = new Date(formattedDate);
                console.log(`Looking for rate applicable to date: ${formattedDate}`);
                
                const applicableRate = perDiemResponse.data.rates.find(rate => {
                    const effectiveDate = new Date(rate.effectiveDate);
                    const expirationDate = new Date(rate.expirationDate);
                    
                    console.log(`Checking rate: ${rate.effectiveDate} to ${rate.expirationDate}`);
                    return targetDate >= effectiveDate && targetDate <= expirationDate;
                });

                if (applicableRate) {
                    console.log('Found applicable rate:', JSON.stringify(applicableRate, null, 2));
                    
                    let lodging = 0, meals = 0, incidentals = 0;
                    
                    if (applicableRate.rate) {
                        lodging = applicableRate.rate.lodging || 0;
                        meals = applicableRate.rate.meals || 0;
                        incidentals = applicableRate.rate.incidentals || 0;
                    } else {
                        lodging = applicableRate.lodging || 0;
                        meals = applicableRate.meals || 0;
                        incidentals = applicableRate.incidentals || 0;
                    }
                    
                    console.log(`City lookup parsed rates - Lodging: ${lodging}, Meals: ${meals}, Incidentals: ${incidentals}`);
                    
                    return res.json({
                        success: true,
                        method: 'city',
                        data: {
                            city: perDiemResponse.data.city,
                            state: perDiemResponse.data.state,
                            lodging: lodging,
                            meals: meals,
                            incidentals: incidentals,
                            total: lodging + meals + incidentals,
                            effectiveDate: applicableRate.effectiveDate,
                            expirationDate: applicableRate.expirationDate
                        }
                    });
                } else {
                    console.log('No rate found for the specified date');
                }
            }
        } catch (cityError) {
            console.error('City lookup failed:', cityError.response?.status, cityError.response?.data || cityError.message);
        }

        console.log('All per diem lookup methods failed');
        res.status(404).json({ error: 'No per diem rate found for the specified location and date' });
        
    } catch (error) {
        console.error('GSA API Error:', error.response?.status, error.response?.data || error.message);
        res.status(500).json({ 
            error: 'Failed to fetch per diem rates',
            details: error.response?.data || error.message
        });
    }
});

// API endpoint to search cities and get zip codes
app.get('/api/search-cities', requireAuth, async (req, res) => {
    try {
        const { query, state } = req.query;
        
        console.log(`City search request: query="${query}", state="${state}"`);
        
        if (!query || query.length < 2) {
            return res.json({ cities: [] });
        }

        // Try multiple approaches to find cities
        const cities = [];

        // Method 1: Direct zip code lookup if query is numeric
        if (/^\d{5}$/.test(query)) {
            try {
                console.log(`Trying direct zip lookup for ${query}`);
                const zipResponse = await axios.get(`${GSA_BASE_URL}/rates/zip/${query}/year/${new Date().getFullYear()}`, {
                    headers: {
                        'X-API-Key': GSA_API_KEY
                    },
                    timeout: 5000
                });

                if (zipResponse.data && zipResponse.data.rates && zipResponse.data.rates.length > 0) {
                    cities.push({
                        city: zipResponse.data.city,
                        state: zipResponse.data.state,
                        county: zipResponse.data.county,
                        zipCode: query,
                        source: 'gsa_zip'
                    });
                    console.log(`Found GSA data for zip ${query}`);
                }
            } catch (error) {
                console.log('Direct zip lookup failed:', error.response?.status, error.message);
            }
        }

        // Method 2: Use zippopotam.us to find cities and their zip codes
        if (state && state.length === 2) {
            try {
                console.log(`Trying zippopotam lookup for ${query}, ${state}`);
                const zipResponse = await axios.get(`http://api.zippopotam.us/us/${state}/${encodeURIComponent(query)}`, {
                    timeout: 5000
                });
                
                if (zipResponse.data && zipResponse.data.places) {
                    zipResponse.data.places.slice(0, 5).forEach(place => {
                        cities.push({
                            city: zipResponse.data['place name'],
                            state: zipResponse.data['state abbreviation'],
                            zipCode: place['post code'],
                            county: place['place name'],
                            source: 'zippopotam'
                        });
                    });
                    console.log(`Found ${zipResponse.data.places.length} places from zippopotam`);
                }
            } catch (error) {
                console.log('Zippopotam lookup failed:', error.message);
            }
        }

        // Remove duplicates based on city/state combination
        const uniqueCities = cities.filter((city, index, self) => 
            index === self.findIndex(c => c.city === city.city && c.state === city.state)
        );

        console.log(`Returning ${uniqueCities.length} unique cities`);
        res.json({ cities: uniqueCities.slice(0, 10) });
        
    } catch (error) {
        console.error('City search error:', error.message);
        res.status(500).json({ error: 'City search failed', cities: [] });
    }
});

    // Start the server
    app.listen(PORT, () => {
        console.log(`Per Diem Calculator running on port ${PORT}`);
        console.log(`Open http://localhost:${PORT} in your browser`);
    });
}

// Start the application
startServer().catch(error => {
    console.error('Failed to start server:', error);
    process.exit(1);
});
