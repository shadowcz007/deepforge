/*jshint node:true, mocha:true*/
/**
 * Generated by PluginGenerator 0.14.0 from webgme on Fri Apr 08 2016 19:50:34 GMT-0500 (CDT).
 */

'use strict';
var testFixture = require('../../globals'),
    path = testFixture.path,
    fs = require('fs'),
    BASE_DIR = testFixture.DF_SEED_DIR;

describe('ImportYaml', function () {
    var gmeConfig = testFixture.getGmeConfig(),
        Q = testFixture.Q,
        GraphChecker = testFixture.requirejs('deepforge/GraphChecker'),
        YAML_DIR = path.join(__dirname, '..', '..', 'test-cases', 'models'),
        expect = testFixture.expect,
        logger = testFixture.logger.fork('ImportYaml'),
        PluginCliManager = testFixture.WebGME.PluginCliManager,
        BlobClient = require('webgme/src/server/middleware/blob/BlobClientWithFSBackend'),
        blobClient = new BlobClient(gmeConfig, logger),
        projectName = 'testProject',
        pluginName = 'ImportYaml',
        checker,
        core,
        project,
        gmeAuth,
        storage,
        commitHash;

    before(function (done) {
        testFixture.clearDBAndGetGMEAuth(gmeConfig, projectName)
            .then(function (gmeAuth_) {
                gmeAuth = gmeAuth_;
                // This uses in memory storage. Use testFixture.getMongoStorage to persist test to database.
                storage = testFixture.getMemoryStorage(logger, gmeConfig, gmeAuth);
                return storage.openDatabase();
            })
            .then(function () {
                var importParam = {
                    projectSeed: testFixture.path.join(BASE_DIR, 'devTests', 'devTests.webgmex'),
                    projectName: projectName,
                    branchName: 'master',
                    logger: logger,
                    gmeConfig: gmeConfig
                };

                return testFixture.importProject(storage, importParam);
            })
            .then(function (importResult) {
                project = importResult.project;
                commitHash = importResult.commitHash;
                core = importResult.core;
                checker = new GraphChecker({
                    core: core,
                    ignore: {
                        attributes: ['calculateDimensionality', 'dimensionalityTransform']
                    }
                });
                return project.createBranch('test', commitHash);
            })
            .then(function () {
                return project.getBranchHash('test');
            })
            .nodeify(done);
    });

    after(function (done) {
        storage.closeDatabase()
            .then(function () {
                return gmeAuth.unload();
            })
            .nodeify(done);
    });

    it('should require yaml file', function (done) {
        var manager = new PluginCliManager(null, logger, gmeConfig),
            pluginConfig = {
            },
            context = {
                project: project,
                namespace: 'nn',
                commitHash: commitHash,
                branchName: 'test',
                activeNode: ''
            };

        manager.executePlugin(pluginName, pluginConfig, context, function (err, pluginResult) {
            expect(err).to.equal('yaml not provided.');
            expect(pluginResult.success).to.equal(false);

            done();
        });
    });

    var runTest = function(name, done) {
        var manager = new PluginCliManager(null, logger, gmeConfig),
            pluginConfig = {},
            context = {
                namespace: 'nn',
                project: project,
                branchName: 'test',
                activeNode: ''
            },
            data = fs.readFileSync(path.join(YAML_DIR, name), 'utf8'),
            ymlFile = path.join(YAML_DIR, name.replace(/lua$/, 'yml')),
            yml = fs.readFileSync(ymlFile, 'utf8'),
            initModels;

        // Load the children from the head of the 'test' branch
        project.getBranchHash('test')
            .then(function (branchHash) {
                return Q.ninvoke(project, 'loadObject', branchHash);
            })
            .then(function (commitObject) {
                return Q.ninvoke(core, 'loadRoot', commitObject.root);
            })
            .then(function (root) {
                return core.loadChildren(root);
            })
            .then(children => {
                initModels = children.map(core.getPath);
                return blobClient.putFile(name, data);  // upload the file
            })
            .then(hash => {
                pluginConfig.srcHash = hash;
                return Q.nfcall(
                    manager.executePlugin.bind(manager),
                    pluginName,
                    pluginConfig,
                    context
                );
            })
            .then(pluginResult => {
                expect(typeof pluginResult).to.equal('object');
                expect(pluginResult.success).to.equal(true);
                return project.getBranchHash('test');
            })
            // Use the check-model object to check the result models!
            .then(function (branchHash) {
                return Q.ninvoke(project, 'loadObject', branchHash);
            })
            .then(function (commitObject) {
                return Q.ninvoke(core, 'loadRoot', commitObject.root);
            })
            .then(function (root) {
                return core.loadChildren(root);
            })
            .then(children => {
                var newModel = children.find(model => 
                    initModels.indexOf(core.getPath(model)) === -1);

                expect(initModels.length+1).to.equal(children.length);
                expect(!!newModel).to.equal(true);  // found the new model
                return core.loadChildren(newModel);
            })
            .then(children => {
                // Retrieve the id of the newly generated node
                var map = checker.gme(children).map.to.yaml(yml);

                expect(!!map).to.equal(true);
            })
            .fail(err => {
                throw err;
            })
            .nodeify(done);
    };

    describe('run test cases', function() {
        var cases = fs.readdirSync(YAML_DIR)
                .filter(name => path.extname(name) === '.yml');

        // one test for each test name
        cases.forEach(name => it(`should run test "${name}"`, runTest.bind(this, name)));
    });
});