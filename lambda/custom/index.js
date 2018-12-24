/* eslint-disable  func-names */
/* eslint-disable  no-console */

/**
 * @name skill-overtime-hours
 * @author Caldi Gianfranco
 * @version 1.0.0
 */

const Alexa = require('ask-sdk-core');
const moment = require('moment-timezone');
const skconfig = require('./config.json');
const mailjet = require('node-mailjet')
    .connect(skconfig.MJ_APIKEY_PUBLIC, skconfig.MJ_APIKEY_PRIVATE);
const { createSessionHelper,
    getSlotValues,
    log,
    TARGET_SPEAKER,
    // TARGET_CARD,
    createComposer,
    createMailjetRequest } = require('./utility.js'),
    ospeak = createComposer(TARGET_SPEAKER)
    //, ocard = createComposer(TARGET_CARD)
    ;

const DATE_FORMAT = 'YYYY-MM-DD',
    MONTH_FORMAT = 'YYYY-MM',
    DATE_LONG_FORMAT = 'dddd, D MMMM',
    DATE_MEDIUM_FORMAT = 'ddd, DD MMM',
    MONTH_LONG_FORMAT = 'MMMM',
    MONTHS_DIGIT = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'],
    // fuso orario italia
    // TODO: recuperare la timezone 
    //  https://developer.amazon.com/docs/smapi/alexa-settings-api-reference.html#request
    //  access token e device id sono in handlerInput.requestEnvelope
    TIMEZONE = 'Europe/Rome';

const CONFIRM_NONE = 'NONE',
    CONFIRM_CONFIRMED = 'CONFIRMED',
    CONFIRM_DENIED = 'DENIED',
    ACTIVE = 'active',
    COMPLETED = 'completed',
    ARCHIVED = 'archived';

const LIST_NAME = 'Straordinari';
const PERMISSIONS = [
    'read::alexa:household:list',
    'write::alexa:household:list',
    'alexa::profile:email:read'];

/**
 * Il formato della durata è: PT<ore>H<minuti>M
 * 
 * @param {String} duration stringa che rappresenta la durata
 * @returns la durata in minuti 
 */
function parseDurationString(duration) {
    const [, , h, , m] = /PT((\d+)H)?((\d+)M)?/.exec(duration) || [];
    log('parseDurationString', duration, h, m);
    return (+h || 0) * 60 + (+m || 0);
}

/**
 * Analzza la stringa in input e ne ricava un elenco di mesi.
 * 
 * I formati riconosciuti sono:
 * - YYYY-MM
 * - YYYY
 * 
 * @param {String} sdate data da analizzare
 * @returns {Array<String>} un array di mesi nel formato YYYY-MM oppure null se il formato non è valido
 */
function parseMonthString(sdate) {
    if (/^\d{4}-\d{2}$/.test(sdate)) {
        return [sdate];
    } else if (/^\d{4}$/.test(sdate)) {
        return MONTHS_DIGIT.map(m => `${sdate}-${m}`);
    } else {
        return null;
    }
}

/**
 * Analzza la stringa in input e ne ricava un elenco di date.
 * 
 * I formati riconosciuti sono:
 * - YYYY-MM-DD
 * - YYYY-W<numero settimana>
 * - YYYY-W<numero settimana>-WE (weekend)
 * 
 * La settimana parte da lunedì.
 * 
 * @param {String} sdate data da analizzare
 * @returns {Array<String>} un array di date nel formato YYYY-MM-DD oppure null se il formato non è valido 
 */
function parseDateString(sdate) {
    if (/^\d{4}-W\d{1,2}-WE$/.test(sdate)) {
        // il formato YYYY-Www ritorna un lunedì
        const date = moment(sdate.substr(0, 8));
        // ritorno il sabato e la domenica
        return [date.weekday(6).format(DATE_FORMAT),
        date.add(1, 'days').format(DATE_FORMAT)];
    } else if (/^\d{4}-W\d{1,2}$/.test(sdate)) {
        // il formato YYYY-Www ritorna un lunedì
        const date = moment(sdate);
        // ritorno dal lunedì a domenica
        return [date.format(DATE_FORMAT), 0, 0, 0, 0, 0, 0]
            .map(v => v || date.add(1, 'days').format(DATE_FORMAT));
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(sdate)) {
        // mi fido che il formato YYYY-MM-DD sia corretto
        return [sdate];
    } else {
        return null;
    }
}

function ensurePastMonths(months, refMonth) {
    return months.map(month => {
        if (month <= refMonth) {
            return month;
        } else {
            const [, y, r] = /(\d{4})(-\d{2})/.exec(month);
            return (+y - 1) + r;
        }
    });
}

function ensurePastDates(dates, refDate) {
    return dates.map(date => {
        if (date <= refDate) {
            return date;
        } else {
            const [, y, r] = /(\d{4})(-\d{2}-\d{2})/.exec(date);
            return (+y - 1) + r;
        }
    });
}

/**
 * Recuper l'id della lista specificata.
 * In caso di permessi mancanti l'errore viene intercettato da ErrorHandler.
 * Una volta travato l'id viene salvato in sessione.
 * Se la lista non esiste, oppure è archiviata, provo a crearla.
 * 
 * @param {Object} handlerInput 
 * @param {Object} sessionHelper 
 * @param {String} listName nome della lista
 * @returns id lista, oppure null non in caso di problemi
 */
async function getListId(handlerInput, sessionHelper, listName) {
    log(`getListId ${listName} ...`);
    // cerco prima in sessione
    let listId = sessionHelper.get('todoListId');
    if (!listId) {
        const listClient = handlerInput.serviceClientFactory.getListManagementServiceClient();
        const listOfLists = await listClient.getListsMetadata();
        // cerco la lista con il nome richieto e lo stato attivo
        const list = listOfLists.lists.find(list => {
            return list.name === listName &&
                list.state === ACTIVE;
        });
        if (list) {
            log('list retrieved:', JSON.stringify(list));
            listId = list.listId;
            sessionHelper.set('todoListId', listId);
        }
    }
    log('... todoListId', listId);
    return listId;
}

/**
 * Crea una nuova lista con il nome specificato.
 * 
 * @param {Object} handlerInput
 * @param {Object} sessionHelper
 * @param {String} listName nome della lista
 * @returns id lista, oppure null non in caso di problemi
 */
async function createList(handlerInput, sessionHelper, listName) {
    log(`createList ${listName} ...`);
    const listClient = handlerInput.serviceClientFactory.getListManagementServiceClient();
    const listObject = {
        name: listName,
        state: ACTIVE
    };
    const result = await listClient.createList(listObject);
    log('new list created', result);
    let listId;
    if (result) {
        listId = result.listId;
        sessionHelper.set('todoListId', listId);
    }
    return listId;
}

/**
 * Aggiunge gli straordinari per le date richieste alla lista specificata.
 * Verrà creato un nuovo elemento per ogni data.
 * 
 * @param {Object} handlerInput 
 * @param {String} listId id lista
 * @param {Number} duration durata degli straordinari in minuti
 * @param {Array<String>} dates elenco di date per cui aggiungere gli straordinari
 * @returns numero totale di elementi nella lista
 */
async function addToList(handlerInput, listId, duration, dates) {
    const listClient = handlerInput.serviceClientFactory.getListManagementServiceClient();
    const list = await listClient.getList(listId, ACTIVE);
    if (!list) {
        return false;
    } else {
        const len = list.items ? list.items.length : 0;
        let prog = 0;
        let count = 0;
        log('addToList len:', len);
        // creo un item per ogni data
        for (const idx in dates) {
            const listItem = {
                // deve essere una stringa di massimo 256 caratteri
                // TODO: trovare un formato che sia leggibile (la lista è consultabile da app)
                //  ma di cui sia possibile il parsing
                value: `#${++prog + len} ${dates[idx]}: ${duration} minuti`,
                status: ACTIVE
            };
            const result = await listClient.createListItem(listId, listItem);
            log('addToList', result);
            result && ++count;
        }
        log('addToList added', count);
        return len + count;
    }
}

/**
 * Estrae il totale dei minuti raggruppati per i giorni indicati.
 * 
 * @param {Object} handlerInput 
 * @param {String} listId 
 * @param {Array<String>} dates elenco dei giorni nel formato YYYY-MM-DD
 * @return una lista che come chiave a il giorno e come valore il totale dei minuti,
 * oppure null se la lista non viene trovata
 */
async function getOvertimeByDays(handlerInput, listId, dates) {
    const listClient = handlerInput.serviceClientFactory.getListManagementServiceClient();
    // recupero tutti gli elementi attivi della lista
    const list = await listClient.getList(listId, ACTIVE);
    if (!list) {
        return null;
    } else if (!list.items || list.items.length === 0) {
        return {};
    } else {
        return list.items.reduce((m, item) => {
            const [, date, duration] = /#\d+\s(\d{4}-\d{2}-\d{2}):\s(\d+)/.exec(item.value) || [];
            if (date && duration && !!~dates.indexOf(date)) {
                m[date] = +duration + (m[date] || 0);
            }
            return m;
        }, {});
    }
}

/**
 * Estrae il totale dei minuti raggruppati per i mesi indicati.
 * 
 * @param {Object} handlerInput 
 * @param {String} listId 
 * @param {Array<String>} months elenco dei mesi nel formato YYYY-MM
 * @return una lista che come chiave a il mese e come valore il totale dei minuti,
 * oppure null se la lista non viene trovata
 */
async function getOvertimeByMonths(handlerInput, listId, months) {
    const listClient = handlerInput.serviceClientFactory.getListManagementServiceClient();
    // recupero tutti gli elementi attivi della lista
    const list = await listClient.getList(listId, ACTIVE);
    if (!list) {
        return null;
    } else if (!list.items || list.items.length === 0) {
        return {};
    } else {
        return list.items.reduce((m, item) => {
            const [, month, duration] = /#\d+\s(\d{4}-\d{2})-\d{2}:\s(\d+)/.exec(item.value) || [];
            if (month && duration && !!~months.indexOf(month)) {
                m[month] = +duration + (m[month] || 0);
            }
            return m;
        }, {});
    }
}

async function getUserEmail(handlerInput) {
    const ups = handlerInput.serviceClientFactory.getUpsServiceClient();
    return ups.getProfileEmail();
}

async function sendListByMail(handlerInput, from, to, listId) {
    const listClient = handlerInput.serviceClientFactory.getListManagementServiceClient();
    // recupero tutti gli elementi attivi della lista
    const list = await listClient.getList(listId, ACTIVE);
    if (!list) {
        return null;
    } else if (!list.items || list.items.length === 0) {
        return null;
    } else {
        const items = list.items
            .map(item => {
                const [, index, date, duration] = /#(\d+)\s(\d{4}-\d{2}-\d{2}):\s(\d+)/.exec(item.value) || [];
                if (date) {
                    return {
                        index,
                        date,
                        duration
                    }
                } else {
                    return null;
                }
            })
            .filter(item => item)
            .sort((a, b) => a.date.localeCompare(b.date));

        // log(`sendListByMail: ${JSON.stringify(items)}`);

        if (items.length > 0) {
            const text = items.reduce((m, item) => {
                return m += `${moment(item.date).locale('it').format(DATE_MEDIUM_FORMAT)}: ${item.duration}\n`;
            }, 'Questi sono tutti i tuoi straordinari (espressi in minuti):\n\n');
            const html = items.reduce((m, item) => {
                return m += `${moment(item.date).locale('it').format(DATE_MEDIUM_FORMAT)}: ${item.duration}<br>`;
            }, 'Questi sono tutti i tuoi straordinari (espressi in minuti):<br><br>');
            const csv = items.reduce((m, item) => {
                return m += `"${item.date}","${item.duration}"\n`;
            }, '"Data","Minuti"\n');

            return mailjet
                .post('send', { version: 'v3.1' })
                .request(createMailjetRequest({
                    from,
                    to,
                    subject: 'Straordinari',
                    text,
                    html,
                    attachments: [
                        {
                            filename: 'straordinari.csv',
                            type: 'text/csv',
                            content: csv
                        }
                    ]
                }));
        } else {
            return null;
        }
    }
}

async function sendProgressive(handlerInput, speech) {
    const requestEnvelope = handlerInput.requestEnvelope;
    const directiveServiceClient = handlerInput.serviceClientFactory.getDirectiveServiceClient();

    const requestId = requestEnvelope.request.requestId;
    const directive = {
        header: {
            requestId,
        },
        directive: {
            type: 'VoicePlayer.Speak',
            speech,
        },
    };

    return directiveServiceClient.enqueue(directive);
}

const LaunchRequestHandler = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === 'LaunchRequest';
    },
    async handle(handlerInput) {
        const responseBuilder = handlerInput.responseBuilder;
        const attr = createSessionHelper(handlerInput);

        try {
            await sendProgressive(handlerInput, 
                // alzo il volume di un poco, perché con il progressivo è più basso del normale
                ospeak.prosody('Benvenuto, con questa skill puoi gestire i tuoi straordinari.', {
                    volume: '+10dB'
                }));
            // recupero subito l'id della lista
            let listId = await getListId(handlerInput, attr, LIST_NAME);
            // se non la trovo provo a crearla
            if (!listId) {
                listId = await createList(handlerInput, attr, LIST_NAME);
            }
            if (!listId) {
                log('list id null!');
                responseBuilder
                    .speak(ospeak.phrase('Non sono riuscito a recuperare la lista.'));
            } else {
                responseBuilder
                    .speak(ospeak.phrase('Cosa vuoi fare?'))
                    .reprompt('Per scoprire tutte le funzionalità di questa skill, prova a chiedere aiuto!');
            }
        } catch (error) {
            log('Error processing events request', error);
            if (error.statusCode === 403) {
                return handlerInput.responseBuilder
                    .speak(ospeak.phrase('Prima di procedere, ti prego di concedere tutti permessi necessari a questa skill, dall\'app Amazon Alexa.',
                        'Grazie.'))
                    .withAskForPermissionsConsentCard(PERMISSIONS)
                    .getResponse();
            } else {
                log(JSON.stringify(handlerInput));
                responseBuilder
                    .speak('Si è verificato un errore!');
            }
        }

        return responseBuilder
            .getResponse();
    },
};

/**
 * Slots:
 * - {hours}  durata straordinario
 * - {preposition} non utilizzata
 * - {date} data
 */
const AddOvertimeIntent = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === 'IntentRequest'
            && handlerInput.requestEnvelope.request.intent.name === 'AddOvertimeIntent';
    },
    async handle(handlerInput) {
        const responseBuilder = handlerInput.responseBuilder;
        const attr = createSessionHelper(handlerInput);

        try {
            // prima di tutto recupero l'id della lista
            // un eventuale problema con i permessi viene intercettato da ErrorHandler
            // TODO: la creazione eventuale della lista impiega qualche secondo, provare a usare getDirectiveServiceClient
            let listId = await getListId(handlerInput, attr, LIST_NAME);
            // se non la trovo provo a crearla
            if (!listId) {
                listId = await createList(handlerInput, attr, LIST_NAME);
            }
            if (!listId) {
                log('list id null!');
                responseBuilder
                    .speak('Non sono riuscito a recuperare la lista.')
                    .withShouldEndSession(true);
            } else {
                const filledSlots = handlerInput.requestEnvelope.request.intent.slots;
                const slotValues = getSlotValues(filledSlots);
                const dialogState = handlerInput.requestEnvelope.request.dialogState;
                const confirmationStatus = handlerInput.requestEnvelope.request.intent.confirmationStatus;
                const refDate = moment().add(1, 'days').tz(TIMEZONE).format(DATE_FORMAT);

                // data -> date YYYY-MM-DD
                // domani -> date YYYY-MM-DD
                // questa maggina -> date YYYY-MM-DD
                // prossimo <giorno settimana> -> date YYYY-MM-DD
                // dopo domani -> non riconosciuto
                // primo <mese> -> date YYYY-MM-01
                // questa settimana -> date YYYY-W<numero settimana>
                // settimana prossima -> date YYYY-W<numero settimana>
                // prossima settimana -> date YYYY-W<numero settimana>
                // questo fine settimana -> date 2018-W<numero settimana>-WE

                // TODO: occorre gestire anche il passatto (ieri, giovedì scorso, etc)

                // TODO: problemone, se pronuncio una data già passata, 
                //  mi viene passata la data per l'anno successivo
                //  soluzione? considero sempre la data come passata, e cambio l'anno di conseguenza?
                // oggi 2018-12-15
                // - 2019-11-05 => 2018-11-05
                //  oggi 2019-01-05
                // - 2019-12-30 => 2018-12-30

                // cerco i parametri prima tra gli attributi di sessione
                let duration = attr.get('duration');
                let dates = attr.get('dates');

                log('AddOvertimeIntent', duration, dates, dialogState, confirmationStatus);

                // e cerco anche tra gli slot di richiesta
                // se manca uno dei due lo chiedo all'utente
                if (duration ||
                    (((duration = (slotValues.duration && slotValues.duration.resolved)) &&
                        (duration = parseDurationString(duration))))) {
                    attr.set('duration', duration);
                    if (dates ||
                        ((dates = (slotValues.date && slotValues.date.resolved))
                            && (dates = parseDateString(dates)))) {
                        dates = ensurePastDates(dates, refDate);
                        attr.set('dates', dates);
                        switch (confirmationStatus) {
                            case CONFIRM_CONFIRMED:
                                // aggiungo i dati alla lista
                                const result = await addToList(handlerInput, listId, duration, dates);
                                if (result === dates.length) {
                                    // se il numero di elementi aggiungi è uguale al numero di date
                                    // significa che è la prima volta che uso la lista
                                    responseBuilder
                                        .speak(ospeak.phrase('Fatto!',
                                            `Puoi consulatare la tua lista ${ospeak.emphasis(LIST_NAME)}, dall'app Amazon Alexa.`))
                                        .withShouldEndSession(true);
                                } else if (result) {
                                    responseBuilder
                                        .speak('Fatto!')
                                        .withShouldEndSession(true);
                                } else {
                                    responseBuilder
                                        .speak('Non ci sono riuscito!')
                                        .withShouldEndSession(true);
                                }
                                break;
                            case CONFIRM_DENIED:
                                responseBuilder
                                    .speak('Richiesta annullata.')
                                    .withShouldEndSession(true);
                                break;
                            default:
                                responseBuilder
                                    .speak(ospeak.phrase(`Ho aggiunto 
                                    ${ospeak.formatMinutes(duration)}, 
                                    a ${ospeak.humanJoin(dates.map(d => moment(d).locale('it').format(DATE_LONG_FORMAT)), 'e')}.`,
                                        'Confermi?'))
                                    .addConfirmIntentDirective()
                                    .withShouldEndSession(false);
                                break;
                        }
                    } else {
                        responseBuilder
                            .speak('Per che giorno?')
                            .addElicitSlotDirective('date')
                            .withShouldEndSession(false);
                    }
                } else {
                    responseBuilder
                        .speak('Per quanto tempo?')
                        .addElicitSlotDirective('duration')
                        .withShouldEndSession(false);
                }
            }
        } catch (error) {
            log('Error processing events request', error);
            if (error.statusCode === 403) {
                return handlerInput.responseBuilder
                    .speak(ospeak.phrase('Prima di procedere, ti prego di concedere tutti permessi necessari a questa skill, dall\'app Amazon Alexa.',
                        'Grazie.'))
                    .withAskForPermissionsConsentCard(PERMISSIONS)
                    .getResponse();
            } else {
                log(JSON.stringify(handlerInput));
                responseBuilder
                    .speak('Si è verificato un errore!');
            }
        }

        return responseBuilder
            .getResponse();
    },
};

const GetOvertimeIntent = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === 'IntentRequest'
            && handlerInput.requestEnvelope.request.intent.name === 'GetOvertimeIntent';
    },
    async handle(handlerInput) {
        const responseBuilder = handlerInput.responseBuilder;
        const attr = createSessionHelper(handlerInput);

        try {
            // prima di tutto recupero l'id della lista
            // un eventuale problema con i permessi viene intercettato da ErrorHandler
            const listId = await getListId(handlerInput, attr, LIST_NAME);
            if (!listId) {
                log('list id null!');
                responseBuilder
                    .speak('La tua lista straodrinari è vuota.')
                    .withShouldEndSession(true);
            } else {
                const filledSlots = handlerInput.requestEnvelope.request.intent.slots;
                const slotValues = getSlotValues(filledSlots);
                const dialogState = handlerInput.requestEnvelope.request.dialogState;
                const refDate = moment().add(1, 'days').tz(TIMEZONE).format(DATE_FORMAT);
                const refMonth = moment().tz(TIMEZONE).format(MONTH_FORMAT);

                // data -> date YYYY-MM-DD
                // domani -> date YYYY-MM-DD
                // questa maggina -> date YYYY-MM-DD
                // prossimo <giorno settimana> -> date YYYY-MM-DD
                // dopo domani -> non riconosciuto
                // primo <mese> -> date YYYY-MM-01
                // questa settimana -> date YYYY-W<numero settimana>
                // settimana prossima -> date YYYY-W<numero settimana>
                // prossima settimana -> date YYYY-W<numero settimana>
                // questo fine settimana -> date 2018-W<numero settimana>-WE

                // TODO: occorre gestire anche il passatto (ieri, giovedì scorso, etc)

                // cerco i parametri prima tra gli attributi di sessione
                let dates = attr.get('dates');
                let months = attr.get('months');

                log('GetOvertimeIntent', dates, dialogState);

                // e cerco anche tra gli slot di richiesta
                // se date è un mese lo salvo nell'attributo months
                if (dates ||
                    ((dates = (slotValues.date && slotValues.date.resolved))
                        && (dates = parseDateString(dates)))) {
                    dates = ensurePastDates(dates, refDate);
                    attr.set('dates', dates);
                    // recupero elenco straordinari per i giorni indicati
                    const data = await getOvertimeByDays(handlerInput, listId, dates);
                    log(`getOvertimeByDays: ${JSON.stringify(data)}`);
                    if (!data) {
                        responseBuilder
                            .speak('Non sono riuscito a recuperare la lista.')
                            .withShouldEndSession(true);
                    } else {
                        const keys = Object.keys(data);
                        if (keys.length === 0) {
                            // TODO: ripetere il periodo (attenzione a giorni, settimana, etc.)
                            responseBuilder
                                .speak('Per il periodo indicato non hai fatto straordinari.')
                                .withShouldEndSession(true);
                        } else {
                            responseBuilder
                                .speak(ospeak.phrase(...keys.map(date => {
                                    return `${moment(date, DATE_FORMAT).locale('it').format(DATE_LONG_FORMAT)}
                                    hai fatto ${ospeak.formatMinutes(data[date])} di straordinari.`
                                }))
                                )
                                .withShouldEndSession(true);
                        }
                    }
                } else if (months ||
                    ((months = (slotValues.date && slotValues.date.resolved))
                        && (months = parseMonthString(months)))) {
                    months = ensurePastMonths(months, refMonth);
                    attr.set('months', months);
                    // recupero elenco straordinari per i mesi indicati
                    const data = await getOvertimeByMonths(handlerInput, listId, months);
                    log(`getOvertimeByMonths: ${JSON.stringify(data)}`);
                    if (!data) {
                        responseBuilder
                            .speak('Non sono riuscito a recuperare la lista.')
                            .withShouldEndSession(true);
                    } else {
                        const keys = Object.keys(data);
                        if (keys.length === 0) {
                            // TODO: ripetere il periodo (attenzione a mese, anno)
                            responseBuilder
                                .speak('Per il periodo indicato non hai fatto straordinari.')
                                .withShouldEndSession(true);
                        } else {
                            responseBuilder
                                .speak(ospeak.phrase(...keys.map(month => {
                                    return `A ${moment(month, MONTH_FORMAT).locale('it').format(MONTH_LONG_FORMAT)}
                                    hai fatto ${ospeak.formatMinutes(data[month])} di straordinari.`
                                }))
                                )
                                .withShouldEndSession(true);
                        }
                    }
                } else {
                    responseBuilder
                        .speak('Per che periodo?')
                        .addElicitSlotDirective('date')
                        .withShouldEndSession(false);
                }
            }
        } catch (error) {
            log('Error processing events request', error);
            if (error.statusCode === 403) {
                return handlerInput.responseBuilder
                    .speak(ospeak.phrase('Prima di procedere, ti prego di concedere tutti permessi necessari a questa skill, dall\'app Amazon Alexa.',
                        'Grazie.'))
                    .withAskForPermissionsConsentCard(PERMISSIONS)
                    .getResponse();
            } else {
                log(JSON.stringify(handlerInput));
                responseBuilder
                    .speak('Si è verificato un errore!');
            }
        }

        return responseBuilder
            .getResponse();
    },
};

const SendOvertimeIntent = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === 'IntentRequest'
            && handlerInput.requestEnvelope.request.intent.name === 'SendOvertimeIntent';
    },
    async handle(handlerInput) {
        const responseBuilder = handlerInput.responseBuilder;
        const attr = createSessionHelper(handlerInput);
        let userEmail;

        try {
            console.time('getListId');
            const listId = await getListId(handlerInput, attr, LIST_NAME);
            console.timeEnd('getListId');
            if (!listId) {
                log('list id null!');
                responseBuilder
                    .speak('La tua lista straodrinari è vuota.')
                    .withShouldEndSession(true);
            } else if ((userEmail = await getUserEmail(handlerInput))) {
                log(`Sending mail to ${userEmail}`);
                const response = await sendListByMail(handlerInput,
                    skconfig['it']['mail_recipe'], userEmail, listId);
                log('response', response);
                responseBuilder
                    .speak('Controlla nella tua casella mail.')
                    .withShouldEndSession(true)
            } else {
                responseBuilder
                    .speak('Non ci sono riuscito!')
                    .withShouldEndSession(true);
            }
        } catch (error) {
            log('Error processing events request => ', error);
            // TODO: differenziare tra errore lista e invio mail
            if (error.statusCode === 403) {
                return handlerInput.responseBuilder
                    .speak(ospeak.phrase('Prima di procedere, ti prego di concedere tutti permessi necessari a questa skill, dall\'app Amazon Alexa.',
                        'Grazie.'))
                    .withAskForPermissionsConsentCard(PERMISSIONS)
                    .getResponse();
            } else {
                log(JSON.stringify(handlerInput));
                responseBuilder
                    .speak('Si è verificato un errore!');
            }
        }

        return responseBuilder
            .getResponse();
    }
};

const HelpIntentHandler = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === 'IntentRequest'
            && handlerInput.requestEnvelope.request.intent.name === 'AMAZON.HelpIntent';
    },
    handle(handlerInput) {
        return handlerInput.responseBuilder
            .speak(ospeak.phrase('I comandi che puoi usare sono:',
                'aggiungi, elenca e invia'))
            .withShouldEndSession(false)
            .getResponse();
    },
};

const CancelAndStopIntentHandler = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === 'IntentRequest'
            && (handlerInput.requestEnvelope.request.intent.name === 'AMAZON.CancelIntent'
                || handlerInput.requestEnvelope.request.intent.name === 'AMAZON.StopIntent');
    },
    handle(handlerInput) {
        const speechText = 'Arrivederci!';

        return handlerInput.responseBuilder
            .speak(speechText)
            .withShouldEndSession(true)
            .getResponse();
    },
};

const SessionEndedRequestHandler = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === 'SessionEndedRequest';
    },
    handle(handlerInput) {
        log(`Session ended with reason: ${handlerInput.requestEnvelope.request.reason}`);

        return handlerInput.responseBuilder.getResponse();
    },
};

const ErrorHandler = {
    canHandle() {
        return true;
    },
    handle(handlerInput, error) {
        console.error(`Error handled: ${JSON.stringify(error)}`);

        // gestisco forbidden per la mancanza di permessi
        if (error.statusCode === 403) {
            return handlerInput.responseBuilder
                .speak(ospeak.phrase('Prima di procedere, ti prego di concedere tutti permessi necessari a questa skill, dall\'app Amazon Alexa.',
                    'Grazie.'))
                .withAskForPermissionsConsentCard(PERMISSIONS)
                .getResponse();
        } else {
            return handlerInput.responseBuilder
                .speak('Scusa, non ho capito.')
                .reprompt('Scusa, non ho capito.')
                .getResponse();
        }
    },
};

exports.handler = Alexa.SkillBuilders
    .custom()
    .addRequestHandlers(
        LaunchRequestHandler,
        AddOvertimeIntent,
        GetOvertimeIntent,
        SendOvertimeIntent,
        HelpIntentHandler,
        CancelAndStopIntentHandler,
        SessionEndedRequestHandler
    )
    .addErrorHandlers(ErrorHandler)
    .withApiClient(new Alexa.DefaultApiClient())
    .lambda();
