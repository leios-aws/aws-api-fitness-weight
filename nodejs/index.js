const config = require('config');
const { google } = require('googleapis');
const fs = require('fs');
const readline = require('readline');
const async = require('async');

/*
https://www.googleapis.com/auth/fitness.activity.read	View your activity information in Google Fit
https://www.googleapis.com/auth/fitness.activity.write	View and store your activity information in Google Fit
https://www.googleapis.com/auth/fitness.blood_glucose.read	View blood glucose data in Google Fit
https://www.googleapis.com/auth/fitness.blood_glucose.write	View and store blood glucose data in Google Fit
https://www.googleapis.com/auth/fitness.blood_pressure.read	View blood pressure data in Google Fit
https://www.googleapis.com/auth/fitness.blood_pressure.write	View and store blood pressure data in Google Fit
https://www.googleapis.com/auth/fitness.body.read	View body sensor information in Google Fit
https://www.googleapis.com/auth/fitness.body.write	View and store body sensor data in Google Fit
https://www.googleapis.com/auth/fitness.body_temperature.read	View body temperature data in Google Fit
https://www.googleapis.com/auth/fitness.body_temperature.write	View and store body temperature data in Google Fit
https://www.googleapis.com/auth/fitness.location.read	View your stored location data in Google Fit
https://www.googleapis.com/auth/fitness.location.write	View and store your location data in Google Fit
https://www.googleapis.com/auth/fitness.nutrition.read	View nutrition information in Google Fit
https://www.googleapis.com/auth/fitness.nutrition.write	View and store nutrition information in Google Fit
https://www.googleapis.com/auth/fitness.oxygen_saturation.read	View oxygen saturation data in Google Fit
https://www.googleapis.com/auth/fitness.oxygen_saturation.write	View and store oxygen saturation data in Google Fit
https://www.googleapis.com/auth/fitness.reproductive_health.read	View reproductive health data in Google Fit
https://www.googleapis.com/auth/fitness.reproductive_health.write	View and store reproductive health data in Google Fit
*/
const SCOPES = ['https://www.googleapis.com/auth/fitness.body.read', 'https://www.googleapis.com/auth/fitness.activity.read'];
const TOKEN_PATH = 'config/token.json';

var authorize = function (args, callback) {
    // Check if we have previously stored a token.
    fs.readFile(TOKEN_PATH, (err, token) => {
        if (err) {
            args.tokenReady = false;
        } else {
            args.tokenReady = true;
            args.oAuth2Client.setCredentials(JSON.parse(token));
        }
        callback(null, args);
    });
};

var makeToken = function (args, callback) {
    if (!args.tokenReady) {
        if (!args.automated) {
            const authUrl = args.oAuth2Client.generateAuthUrl({
                access_type: 'offline',
                scope: SCOPES,
            });
            console.log('Authorize this app by visiting this url:', authUrl);
            const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

            rl.question('Enter the code from that page here: ', (code) => {
                rl.close();
                args.oAuth2Client.getToken(code, (err, token) => {
                    if (err) {
                        console.error('Error retrieving access token', err);
                        callback(err, args);
                        return;
                    }
                    args.oAuth2Client.setCredentials(token);
                    // Store the token to disk for later program executions
                    fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
                        if (err) {
                            console.error(err);
                            callback(err, args);
                            return;
                        }
                        console.log('Token stored to', TOKEN_PATH);
                        callback(null, args);
                        return;
                    });

                });
            });
        } else {
            callback("Token does not exist!", args);
        }
    } else {
        callback(null, args);
    }
};

exports.handler_auth = function (event, context, callback) {
    async.waterfall([
        function (callback) {
            const { client_secret, client_id, redirect_uris } = config.get('installed');
            callback(null, {
                oAuth2Client: new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]),
                automated: false,
                tokenReady: false,
            });
        },
        authorize,
        makeToken,
    ], function (err, result) {
        if (!err) {
            const service = google.fitness({ version: 'v1', auth: result.oAuth2Client });
        }

    });
};

exports.handler = function (event, context, callback) {
    async.waterfall([
        function (callback) {
            const { client_secret, client_id, redirect_uris } = config.get('installed');
            callback(null, {
                oAuth2Client: new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]),
                automated: true,
                tokenReady: false,
            });
        },
        authorize,
        makeToken,
        function (args, callback) {
            var values = [];

            const service = google.fitness({ version: 'v1', auth: args.oAuth2Client });
            /*
            service.users.dataSources.list({ userId: 'me' }, function (err, result) {
                console.log(err);   // it returns only null
                if (!err) {
                    console.log(result.data); //it returns only {}
                }
                callback(err);
            });
            */
            service.users.dataset.aggregate({
                userId: 'me', resource: {
                    aggregateBy: [
                        {
                            dataSourceId: 'raw:com.google.weight:com.xiaomi.hm.health:'
                        }
                    ],
                    endTimeMillis: Date.now().toString(),
                    startTimeMillis: (Date.now() - 30 * 24 * 60 * 60 * 1000).toString(),
                }
            }, function (err, result) {
                if (err) {
                    console.log(err);   // it returns only null
                } else if (result && result.data && result.data.bucket && result.data.bucket.length > 0) {
                    var buckets = result.data.bucket;
                    for (var i = 0; i < buckets.length; i++) {
                        var bucket = buckets[i];
                        for (var j = 0; j < bucket.dataset.length; j++) {
                            var dataset = bucket.dataset[j];
                            for (var k = 0; k < dataset.point.length; k++) {
                                var point = dataset.point[k];
                                for (var l = 0; l < point.value.length; l++) {
                                    values.push({t: point.startTimeNanos / 1000 / 1000, y: point.value[l].fpVal});
                                }
                            }
                        }
                    }
                }
                callback(err, values);
            });
        }
    ], function (err, results) {
        if (err) {
            console.log(err);
        } else {
            callback(err, {
                "statusCode": 200,
                "headers": {
                    'Access-Control-Allow-Origin': '*'
                },
                "body": JSON.stringify(results),
                "isBase64Encoded": false
            });
        }
    });
};
