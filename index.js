// Base
const githubModule = {};

// Start
githubModule.start = function (data) {
    const express = require('@tinypudding/firebase-webhook-express-default');
    githubModule.app = express(async (req, res) => {

        // Action
        await require('./files/process')(req, res, data);

        // Final Script
        return;

    });
};

// Module
module.exports = githubModule;