"use strict";

const should = require('should');
const cluster = require('cluster');

describe('Abort ConductorWorker', () => {

    const ConductorWorker = require('../../ConductorWorker');

    it('should run', (done) => {

        const worker = new ConductorWorker();

        worker.logging = false;

        worker.error('text should not appear');

        worker.sendRequestToMaster('ready', {}, () => {});

        worker.processJob = function(job) {
            //console.log('worker job: ', job);

            // Never complete this thing
        };

        worker.on('error', (err) => {
            throw err;
        });

        var jobsDone = 0;
        worker.on('job_done', (job) => {
            should(job).be.a.String();
            jobsDone++;
        });

        worker.on('completed', () => {
            done();
        });

        worker.start();
    });

});