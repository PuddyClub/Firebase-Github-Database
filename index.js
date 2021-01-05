// Base
const githubModule = {};

// Start
githubModule.start = function (data) {
    const express = require('firebase-webhook-express-default');
    githubModule.app = express(async (req, res) => {

        // Action
        await require('./files/process')(req, res, data);

        // Final Script
        return;

    });
};

// Module
module.exports = githubModule;