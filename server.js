const express = require("express");
const client = require("./src/config/db");

const app = express();

app.get("/test-db", async (req, res) => {
    try {
        const result = await client.query("SELECT NOW()");
        res.json({
            status: "ok",
            time: result.rows[0].now
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(3000, () => console.log("Servidor en puerto 3000"));
