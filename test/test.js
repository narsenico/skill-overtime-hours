/**
 * skill-overtime-hours
 * test con mocha e chai
 * 
 * mocha test.js --reporter list
 * mocha test.js --reporter markdown > README.md
 * 
 * @see https://github.com/BrianMacIntosh/alexa-skill-test-framework/blob/master/examples/skill-sample-nodejs-hello-world/helloworld-tests.js
 */

const alexaTest = require('alexa-skill-test-framework'),
    { expect } = require('chai'),
    moment = require('../lambda/custom/node_modules/moment-timezone');

const TEST_DEBUG = !!~process.argv.indexOf('--test-debug'),
    TEST_ALL = !!~process.argv.indexOf('--test-all'),
    TEST_LAUNCH = TEST_ALL || !!~process.argv.indexOf('--test-launch'),
    TEST_ADD = TEST_ALL || !!~process.argv.indexOf('--test-add');

const DATE_FORMAT = 'YYYY-MM-DD',
    DATE_LONG_FORMAT = 'dddd, D MMMM';

Array.prototype.random = function () {
    return this[Math.floor(Math.random() * this.length)];
};

// disabilito il debug della skill, a meno che non passi l'arg --test-debug
if (!TEST_DEBUG) {
    process.env.NO_DEBUG = 'no';
}

// recupero la skill_id dal file .ask/config
const { deploy_settings: { default: { skill_id } } } = JSON.parse(require('fs').readFileSync(__dirname + '/../.ask/config', 'utf8'));

alexaTest.initialize(
    require('../lambda/custom/index.js'),
    skill_id,
    'amzn1.ask.account.VOID');

alexaTest.setLocale('it-IT');

function createRequest(intentName, slots) {
    if (slots && !Array.isArray(slots)) {
        slots = [slots];
    }
    if (slots && slots.length > 0) {
        const request = alexaTest.getIntentRequest(intentName, slots.reduce((m, slot) => {
            m[slot.name] = slot.synonim || slot.value;
            return m;
        }, {}));
        return slots.reduce((request, slot) => {
            return requestWithEntityResolution = alexaTest.addEntityResolutionToRequest(
                request,
                slot.name,
                slot.type,
                slot.value,
                slot.id
            );
        }, request);
    } else {
        return alexaTest.getIntentRequest(intentName);
    }
}

/**
 * 
 * @param {String} intentName 
 * @param {Any} slots 
 * @param {Boolean} repromptsNothing 
 * @param {Boolean} shouldEndSession 
 * @param {Function} cb 
 */
function test(intentName, slots, repromptsNothing, shouldEndSession, cb) {
    alexaTest.test([
        {
            request: intentName ?
                createRequest(intentName, slots) :
                alexaTest.getLaunchRequest(),
            repromptsNothing,
            shouldEndSession,
            saysCallback: cb
        }
    ]);
}

describe('il mio straordinario', function () {

    if (TEST_LAUNCH) {
        describe('Benvenuto', function () {
            test(null, null, false, false, (context, speech) => {
                expect(context.framework.locale).is.eq('it-IT');
                expect(speech).to.match(/Benvenuto/);
            });
        });
    }

    if (TEST_ADD) {
        describe('Aggiungi 1 ora e 5 minuti a oggi', function () {
            test('AddOvertimeIntent', [{
                name: 'duration',
                type: 'AMAZON.DURATION',
                value: 'PT1H5M',
                synonim: null,
                id: null
            }, {
                name: 'preposition',
                type: 'TYPE_PREPOSITION',
                value: 'a',
                synonim: 'al',
                id: null
            }, {
                name: 'date',
                type: 'AMAZON.DATE',
                value: moment().format(DATE_FORMAT),
                synonim: null,
                id: null
            }], false, false, (context, speech) => {
                expect(speech).to.match(/un\'ora\se\s5\sminuti/);
            });
        });

        describe('Giorno non specificato', function () {
            test('AddOvertimeIntent', [{
                name: 'duration',
                type: 'AMAZON.DURATION',
                value: 'PT1H5M',
                synonim: null,
                id: null
            }], false, false, (context, speech) => {
                expect(speech).to.match(/Per\sche\sgiorno\?/);
            });
        });
    }
});