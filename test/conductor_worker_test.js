"use strict";

const cluster = require('cluster');

if (!cluster.isMaster) {

    // Find the test file for this worker
    require('./worker_tests/' + process.env.test_type);

}