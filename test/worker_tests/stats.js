"use strict";

const should = require('should');

describe('Basic ConductorWorker', () => {

    const ConductorWorker = require('../../ConductorWorker');

    it('should run', (done) => {

        const worker = new ConductorWorker();

        worker.logging = false;
        worker.statsInterval = 200;

        worker.stats.customMetric = 0;

        worker.error('text should not appear');

        worker.on('stats', (/*data*/) => {
            //console.log('stats here', data);
        });

        worker.processJob = function(job) {
            // console.log(`worker ${this.workerId}, job: ${job}`);

            if (["job 1", "job 2", "job 8", "job 9"].indexOf(job) >= 0) {
                worker.stats.customMetric++;
            }

            if (job === "job 5" || job === "job 6") {
                // Delay to force delay on stats on both workers
                setTimeout(() => {
                    this.completeJob(null, job);
                }, 300)
            } else {
                // Just complete the job
                setImmediate(() => this.completeJob(null, job));
            }
        };

        worker.on('error', (err) => {
            throw err;
        });

        // let jobsDone = 0;
        worker.on('job_done', (job) => {
            should(job).be.a.String();
            // jobsDone++;
        });

        worker.on('completed', () => {
            done();
        });

        worker.start();
    });

});