// Credits
// https://github.com/rvagg/github-webhook-handler

// Prepare Modules
const crypto = require('crypto');

// Prepare Options
let options;

// Find Handler
function findHandler(url, arr) {
    if (!Array.isArray(arr)) {
        return arr
    }

    let ret = arr[0]
    for (let i = 0; i < arr.length; i++) {
        if (url === arr[i].path) {
            ret = arr[i]
        }
    }

    return ret
}

// Sign
function sign(data) {
    return `sha1=${crypto.createHmac('sha1', options.secret).update(data).digest('hex')}`;
}

// Verify
function verify(signature, data) {
    const sig = Buffer.from(signature);
    const signed = Buffer.from(sign(data));
    if (sig.length !== signed.length) {
        return false;
    }
    return crypto.timingSafeEqual(sig, signed);
}

// Check Type
function checkType(options) {

    // No Object
    if (typeof options !== 'object') {
        throw new TypeError('must provide an options object')
    }

    // No Secret
    if (typeof options.secret !== 'string') {
        throw new TypeError('must provide a \'secret\' option')
    }

}

// Handler
async function handler(req, res, data) {

    // Prepare HTTP Page
    const http_page = require('puddy-lib/http/HTTP-1.0');
    let error_made = false;

    try {

        // Lodash Module
        const _ = require('lodash');

        // Create Settings
        const tinyCfg = _.defaultsDeep({}, data.firebase, {
            options: {
                id: "main",
                autoStart: {
                    database: true
                }
            }
        });

        // Prepare Event
        let events;

        // Start Firebase
        const firebase = require('puddy-lib/firebase');
        firebase.start(require('firebase-admin'), tinyCfg.options, tinyCfg.firebase);

        // App
        const app = firebase.get(tinyCfg.options.id);
        const db = app.db.ref('github');
        let initOptions = null;

        // Get Settings
        initOptions = await firebase.getDBAsync(db.child('settings'));
        initOptions = firebase.getDBValue(initOptions);
        if (!initOptions) { initOptions = {}; }

        // validate type of options
        if (Array.isArray(initOptions)) {
            for (let i = 0; i < initOptions.length; i++) {
                checkType(initOptions[i])
            }
        } else {
            checkType(initOptions)
        }

        options = findHandler(req.url, initOptions)

        if (typeof options.events === 'string' && options.events !== '*') {
            events = [options.events];
        } else if (Array.isArray(options.events) && options.events.indexOf('*') === -1) {
            events = options.events;
        }

        // Error Page
        async function hasError(msg) {

            // Show Error
            console.error(msg);
            await db.child('error').set({
                message: msg
            });

            // Show Error Page
            if (!error_made) {
                error_made = true;
                return http_page.send(res, 404);
            } else {
                return;
            }

        }

        // Headers
        const sig = req.headers['x-hub-signature'];
        const event = req.headers['x-github-event'];
        const id = req.headers['x-github-delivery'];

        // Error List
        if (!sig) {
            const err = await hasError('No X-Hub-Signature found on request');
            return err;
        }

        if (!event) {
            const err = await hasError('No X-Github-Event found on request');
            return err;
        }

        if (!id) {
            const err = await hasError('No X-Github-Delivery found on request');
            return err;
        }

        if (events && events.indexOf(event) === -1) {
            const err = await hasError('X-Github-Event is not acceptable');
            return err;
        }

        // Verify
        if (!verify(sig, req.rawBody)) {
            const err = await hasError('X-Hub-Signature does not match blob signature');
            reject(err);
        }

        // Complete
        else {

            // Events DB
            const events_db = db.child('events').child(firebase.databaseEscape(event));

            // Send Event
            await events_db.set({
                sig: sig,
                id: id,
                payload: req.body,
                protocol: req.protocol,
            });

            // Send Repository Event
            if (req.body && req.body.repository && typeof req.body.repository.full_name === "string" && req.body.repository.full_name.length > 0) {

                // Get Repository Path
                const repository_db = db.child('repositories').child(
                    firebase.databaseEscape(req.body.repository.full_name, true)
                );

                // Get Repository Items
                const repository_db_data = repository_db.child('data');
                const repository_db_event = repository_db.child('events').child(firebase.databaseEscape(event));

                // Get OLD Repository
                let old_version_name = await firebase.getDBAsync(repository_db_data.child('full_name'));
                old_version_name = firebase.getDBValue(old_version_name);

                // Remove OLD Name
                if (typeof old_version_name === "string" && old_version_name !== req.body.repository.full_name) {
                    await db.child('repositories').child(firebase.databaseEscape(old_version_name, true)).remove();
                }

                // Custom Module Config
                let custom_modules = [];
                const custom_module_manager = require('puddy-lib/libs/custom_module_loader');
                const custom_module_options = {
                    
                    // Database
                    db: {
                        repository: {
                            data: repository_db_data,
                            event: repository_db_event
                        },
                        event: events_db
                    },

                    // Data
                    data: req.body,
                    repository: req.body.repository

                };
                if (Array.isArray(data.modules)) {
                    custom_modules = data.modules;
                }

                // Exist
                if (!req.body.deleted) {

                    // Post Repository Data
                    await repository_db_data.set(req.body.repository);

                    // Prepare Event
                    const event_push = {

                        // Info Prepare
                        rep_info: {
                            sig: sig,
                            id: id,
                            protocol: req.protocol
                        }

                    };

                    // Get File Type
                    const objType = require('puddy-lib/get/objType');

                    // Get More Info
                    for (const item in req.body) {
                        if (item !== "repository") {

                            // Nope Before After
                            if (item !== "before" && item !== "after" && item !== "compare") {

                                // Is Item
                                if (objType(req.body[item], 'object') || Array.isArray(req.body[item])) {
                                    event_push[item] = req.body[item];
                                }

                                // Nope
                                else {
                                    event_push.rep_info[item] = req.body[item];
                                }

                            }

                            // Yes
                            else {
                                event_push[item] = req.body[item];
                            }

                        }
                    }

                    // Post Event
                    await repository_db_event.set(event_push);
                    custom_module_options.event = event_push;
                    
                    // Send to Custom Modules
                    await custom_module_manager.run(custom_modules, custom_module_options, 'add');

                }

                // Nope
                else {

                    // Remove Repository
                    await repository_db.remove();
                    await custom_module_manager.run(custom_modules, custom_module_options, 'remove');

                }

            }

            // Complete
            return res.json({ ok: true });

        }

        return;

    } catch (err) {

        // HTTP Page
        console.error(err);
        console.error(err.message);
        if (!error_made) {
            return http_page.send(res, 500);
        }

    }

}

module.exports = handler;