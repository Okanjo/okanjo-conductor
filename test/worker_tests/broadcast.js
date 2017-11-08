"use strict";

const should = require('should');
const cluster = require('cluster');

describe('Broadcast ConductorWorker', () => {

    const ConductorWorker = require('../../ConductorWorker');

    it('should run', (done) => {

        const worker = new ConductorWorker();

        worker.logging = false;


        worker.error('text should not appear');

        worker.sendRequestToMaster('ready', {}, () => {});

        worker.onMasterMessage = function(msg) {
            // console.log('GOT MESSAGE', msg, 'OUR MASTER IS', worker.masterId)
            if (msg.cmd) {
                switch (msg.cmd) {

                    case "hellothere":
                        should(msg.data.whats).be.exactly('up');
                        worker.sendRequestToMaster('got it boss', {}, () => {});
                        return;
                }
            }

            this.fireRequestCallback(msg.callback, msg);
        };

        worker.processJob = function(job) {
            //console.log('worker job: ', job);


            if (job === "job 5" || job === "job 6") {
                // Delay to force delay on stats on both workers
                setTimeout(() => {
                    this.completeJob(null, job);
                }, 200)
            } else {
                // Just complete the job
                this.completeJob(null, job);
            }
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