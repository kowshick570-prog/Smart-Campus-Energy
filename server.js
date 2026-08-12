require('dotenv').config();
const express = require('express');
const mqtt = require('mqtt');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// 1. Supabase Client Setup
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// 2. HiveMQ Cloud MQTT Client Setup
const mqttClient = mqtt.connect(process.env.HIVEMQ_URL, {
    port: 8883,
    protocol: 'mqtts',
    username: process.env.HIVEMQ_USER,
    password: process.env.HIVEMQ_PASSWORD
});

mqttClient.on('connect', () => {
    console.log('HiveMQ MQTT Broker connected successfully!');
    // Subscribe to all campus telemetry topics
    mqttClient.subscribe('campus/+/+/telemetry');
});

// 3. Receive Data from ESP32 & Store in Supabase
mqttClient.on('message', async (topic, message) => {
    try {
        const data = JSON.parse(message.toString());
        console.log(`Received data from ${topic}:`, data);

        // Save to Supabase DB
        const { error } = await supabase.from('energy_logs').insert([
            {
                block_id: data.block_id,
                floor_id: data.floor_id,
                voltage: data.voltage,
                current: data.current,
                power: data.power,
                energy_kwh: data.energy_kwh
            }
        ]);

        if (error) console.error('Error inserting to Supabase:', error);

        // Check for Overload Anomaly Alert
        if (data.power > 3000) { // Example threshold: 3000 Watts
            console.log(`ALERT: Overload detected in ${data.block_id}!`);
            // Trigger MQTT command to trip relay
            mqttClient.publish(`campus/${data.block_id}/${data.floor_id}/control`, JSON.stringify({ relay: "OFF" }));
        }

    } catch (err) {
        console.error('Data processing error:', err);
    }
});

// 4. REST API Endpoint for React Dashboard
app.get('/api/energy-data', async (req, res) => {
    const { data, error } = await supabase
        .from('energy_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Backend server running on port ${PORT}`));