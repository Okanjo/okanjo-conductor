"use strict";

const should = require('should');

describe('Basic ConductorWorker', () => {

    const ConductorWorker = require('../../ConductorWorker');

    it('should run', (done) => {

        const worker = new ConductorWorker();

        worker.logging = false;

        worker.error('text should not appear');

        worker.on('stats', (/*data*/) => {
            //console.log('stats here', data);
        });

        worker.processJob = function(job) {
            //console.log('worker job: ', job);

            if (job === "job 1") {
                // Test custom messaging commands
                worker.sendRequestToMaster('override-me', { key: 'val' }, (err, payload) => {
                    should(err).not.be.ok();
                    payload.workerId.should.be.a.Number();
                    payload.cmd.should.be.exactly('override-me');
                    payload.data.should.be.exactly('nope');
                    payload.callback.should.be.a.String();
                    this.completeJob(null, job);
                });
            } else if (job === "job 2") {
                // Test lookups
                this.lookup('poop', 'girth', (err, data) => {
                    data.name.should.be.exactly('poop');
                    data.key.should.be.exactly('girth');
                    should(data.value).be.exactly(undefined);

                    this.setLookup('poop', 'girth', 42, (err, data) => {
                        should(data).be.exactly(undefined);

                        this.lookup('poop', 'girth', (err, data) => {
                            data.name.should.be.exactly('poop');
                            data.key.should.be.exactly('girth');
                            data.value.should.be.exactly(42);
                            this.completeJob(null, job);
                        });
                    });
                });
            } else {
                // Just complete the job
                this.completeJob(null, job);
            }

            //this.lookup('whatever', 'key', (res) => {
            //    //console.log('got lookup res', res);
            //    setTimeout(() => {
            //        this.completeJob(undefined, job);
            //    }, 2500)
            //});

        };

        worker.on('error', (err) => {
            throw err;
        });

        worker.on('job_done', (job) => {
            should(job).be.a.String();
        });

        worker.on('completed', () => {
            done();
        });

        worker.start();
    });

});