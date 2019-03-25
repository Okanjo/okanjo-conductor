"use strict";

const should = require('should');

describe('Messages ConductorWorker', () => {

    const ConductorWorker = require('../../ConductorWorker');

    it('should handle custom messaging in various ways', (done) => {

        const worker = new ConductorWorker({ logging: false });


        worker.onMasterMessage = function(msg) {
            if (msg.cmd) {
                switch (msg.cmd) {

                    case "good":
                        should(msg.data.poop).be.exactly('Yes');
                        this.fireRequestCallback(msg.callback, null, msg);
                        return;
                }
            }

            this.fireRequestCallback(msg.callback, null, msg);
        };

        worker.on('stats', (/*data*/) => {
            //console.log('stats here', data);
        });

        worker.processJob = function(job) {
            //console.log('worker job: ', job);

            if (job === "job 1") {
                // Test custom command
                worker.sendRequestToMaster('good', {key: 'val'}, (err, payload) => {
                    should(err).not.be.ok();
                    payload.workerId.should.be.a.Number();
                    payload.cmd.should.be.exactly('good');
                    payload.data.poop.should.be.exactly('Yes');
                    payload.callback.should.be.a.String();
                    this.completeJob(null, job);
                });
            } else if (job === "job 2") {
                // Send a message with no callback
                worker.sendRequestToMaster('nope');
                this.completeJob(null, job);
            } else if (job === "job 3") {
                // Lookup with no callback, because some butt hole will do it
                this.lookup('poop', 'nope');
                this.completeJob(null, job);
            } else if (job === "job 4") {
                // Set lookup reference with no callback (for lazy people)
                this.setLookup('poop', 'girth', 42);
                this.completeJob(null, job);
            } else if (job === "job 5") {
                worker.sendRequestToMaster('good', {key: 'val'});
                this.completeJob(null, job);
            } else if (job === "job 6") {
                process.send('haha business!');
                this.completeJob(null, job);
            } else if (job === "job 7") {
                worker.sendRequestToMaster('bogus', {key: 'val'});
            } else if (job === "job 8") {
                worker.sendRequestToMaster('kaboom');
                //this.completeJob(null, job);
            } else if (job === "job 9") {
                // Delay on the last job to make sure that one worker finishes
                setTimeout(() => this.completeJob(null, job), 510);
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