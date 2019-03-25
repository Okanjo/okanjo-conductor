"use strict";

const should = require('should');

describe('Error ConductorWorker', () => {

    const ConductorWorker = require('../../ConductorWorker');

    it('should error/crash in various ways', (done) => {

        const worker = new ConductorWorker({ logging: true });

        worker.on('stats', (/*data*/) => {
            //console.log('stats here', data);
        });

        worker.processJob = function(job) {
            //console.log('worker job: ', job);

            if (job === "job 1") {
                // Test unknown command
                worker.sendRequestToMaster('unknown-cmd', { key: 'val' }, (err, payload) => {
                    should(err).not.be.ok();
                    payload.workerId.should.be.a.Number();
                    payload.cmd.should.be.exactly('unknown-cmd');
                    payload.data.error.should.match(/onWorkerMessage/);
                    payload.callback.should.be.a.String();
                    this.completeJob(null, job);
                });
            } else if (job === "job 2") {
                // Test unknown command
                worker.sendRequestToMaster('', { key: 'val' }, (err, payload) => {
                    should(err).not.be.ok();
                    payload.workerId.should.be.a.Number();
                    payload.cmd.should.be.exactly('error');
                    payload.data.error.should.match(/onWorkerMessage/);
                    payload.callback.should.be.a.String();
                    this.completeJob(null, job);
                });
            } else if (job === "job 3") {
                 //Crash!
                this.completeJob(new Error('KABOOM!'), job);
            } else {
                // Just complete the job
                this.completeJob(null, job);
            }
        };

        // let errors = 0;
        worker.on('error', (err) => {
            //console.log(err);
            should(err.job).be.exactly("job 3");
            should(err.error).match(/KABOOM/);
            // errors++;
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