const express = require('express');
const multer = require('multer');
const Tesseract = require('tesseract.js');
const cors = require('cors');
const fs = require('fs');
const axios = require('axios');

const app = express();
const port = 3000;
const API_KEY = '0a0f0aa32208dbf3ab2b3a6ac1467653';

let watchedFlights = {}; 

app.use(cors());
app.use(express.json());

const upload = multer({ dest: 'uploads/' });

// Coordonnées approximatives des principaux aéroports (Fallback)
const AIRPORT_COORDS = {
    'CDG': { lat: 49.0097, lon: 2.5479 }, // Paris Charles de Gaulle
    'ORY': { lat: 48.7262, lon: 2.3652 }, // Paris Orly
    'JFK': { lat: 40.6413, lon: -73.7781 }, // New York JFK
    'LHR': { lat: 51.4700, lon: -0.4543 }, // Londres Heathrow
    'DXB': { lat: 25.2532, lon: 55.3657 }, // Dubai
    'AMS': { lat: 52.3105, lon: 4.7683 }, // Amsterdam
    'LAX': { lat: 33.9416, lon: -118.4085 }, // Los Angeles
    'HND': { lat: 35.5494, lon: 139.7798 }, // Tokyo Haneda
    'SIN': { lat: 1.3644, lon: 103.9915 }, // Singapore
    'FRA': { lat: 50.0379, lon: 8.5622 }, // Francfort
    'NCE': { lat: 43.6584, lon: 7.2158 }, // Nice
    'BOD': { lat: 44.8283, lon: -0.7155 }, // Bordeaux
    'TLS': { lat: 43.6291, lon: 1.3638 }, // Toulouse
    'LYS': { lat: 45.7255, lon: 5.0811 }, // Lyon
    'MRS': { lat: 43.4367, lon: 5.2150 }, // Marseille
};

const getRealFlightStatus = async (flightIata) => {
    try {
        const response = await axios.get('http://api.aviationstack.com/v1/flights', {
            params: {
                access_key: API_KEY,
                flight_iata: flightIata,
                limit: 1
            }
        });

        const data = response.data.data && response.data.data[0];

        if (!data) return { status: 'Non trouvé', info: 'Pas d\'info récente.', rawStatus: 'unknown' };

        const statusMap = {
            'scheduled': 'Programmé',
            'active': 'En vol',
            'landed': 'Atterri',
            'cancelled': 'Annulé',
            'incident': 'Incident',
            'diverted': 'Dérouté',
            'delayed': 'Retardé'
        };

        const status = statusMap[data.flight_status] || data.flight_status;
        const depIata = data.departure.iata;
        const arrIata = data.arrival.iata;
        const depName = data.departure.airport || depIata;
        const arrName = data.arrival.airport || arrIata;
        
        let delayInfo = 'À l\'heure';
        if (data.arrival.delay) delayInfo = `Retard: ${data.arrival.delay} min`;
        else if (status === 'Retardé') delayInfo = 'Retard signalé';

        // Récupération des coordonnées (Soit fallback, soit 0,0)
        // Note: L'API gratuite ne donne pas toujours les coords complètes
        const depCoords = AIRPORT_COORDS[depIata] || { lat: 48.8566, lon: 2.3522 }; // Paris par défaut
        const arrCoords = AIRPORT_COORDS[arrIata] || { lat: 40.7128, lon: -74.0060 }; // NY par défaut

        return {
            status: status,
            depCode: depIata,
            arrCode: arrIata,
            depName: depName,
            arrName: arrName,
            depCoords,
            arrCoords,
            delayInfo: delayInfo,
            rawStatus: data.flight_status,
            airline: data.airline.name || 'Compagnie'
        };

    } catch (error) {
        console.error(`Erreur API pour ${flightIata}:`, error.message);
        return { status: 'Erreur', info: 'Impossible de contacter l\'API.', rawStatus: 'error' };
    }
};

app.get('/', (req, res) => res.send('Flight Scanner Backend with Maps'));

app.post('/scan-flight', upload.single('photo'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'Aucune image.' });

        console.log(`Scan image...`);
        const { data: { text } } = await Tesseract.recognize(req.file.path, 'eng');
        fs.unlinkSync(req.file.path);

        const flightRegex = /(AF|U2|FR|KL|DL)\s?([0-9]{3,4})/gi;
        const matches = [...text.matchAll(flightRegex)];
        
        const uniqueFlights = [...new Set(matches.map(m => `${m[1].toUpperCase()}${m[2]}`))];

        if (uniqueFlights.length === 0) {
            return res.json({ success: true, flights: [], message: "Aucun vol détecté." });
        }

        const flightsData = await Promise.all(uniqueFlights.map(async (flightCode) => {
            const statusData = await getRealFlightStatus(flightCode);
            watchedFlights[flightCode] = { ...statusData, lastUpdate: new Date() };
            return { flight: flightCode, ...statusData };
        }));

        res.json({ success: true, flights: flightsData });

    } catch (error) {
        console.error('Erreur:', error);
        res.status(500).json({ error: 'Erreur analyse.' });
    }
});

app.get('/check-updates', async (req, res) => {
    const flightsToCheck = req.query.flights ? req.query.flights.split(',') : [];
    const updates = [];
    for (const flightCode of flightsToCheck) {
        if (watchedFlights[flightCode]) {
            updates.push({ flight: flightCode, ...watchedFlights[flightCode] });
        }
    }
    res.json({ success: true, updates });
});

app.listen(port, () => {
    console.log(`Serveur prêt sur http://localhost:${port}`);
});
