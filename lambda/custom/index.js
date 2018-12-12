/* eslint-disable  func-names */
/* eslint-disable  no-console */

/**
 * @name skill-overtime-hours
 * @author Caldi Gianfranco
 * @version 1.0.0
 */

const Alexa = require('ask-sdk-core');
const AWS = require('aws-sdk');
const moment = require('moment-timezone');
const skconfig = require('./config.json');
const { createSessionHelper,
    getSlotValues,
    log,
    TARGET_SPEAKER,
    // TARGET_CARD,
    createComposer } = require('./utility.js'),
    ospeak = createComposer(TARGET_SPEAKER)
    //, ocard = createComposer(TARGET_CARD)
    ;

const DATE_FORMAT = 'YYYY-MM-DD',
    DATE_LONG_FORMAT = 'dddd, D MMMM',
    DAY_OF_WEEK = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'],
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

AWS.config.update({ region: 'eu-west-1' });

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
 * - giorni della settimana
 * 
 * La settimana parte da lunedì.
 * 
 * @param {String} sdate data da analizzare
 * @returns {Array<String>} un array di date nel formato YYYY-MM-DD oppure null se il formato non è valido 
 */
function parseDateString(sdate) {
    const dayOfWeek = DAY_OF_WEEK.indexOf(sdate);
    if (dayOfWeek >= 0) {
        return [nextDay(dayOfWeek).format(DATE_FORMAT)];
    } else if (/^\d{4}-W\d{1,2}-WE$/.test(sdate)) {
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

/**
 * Ritorna mdate se il giorno della settimana corrisponde con dayOfWeek,
 * oppure il prossimo giorno con quel dayOfWeek.
 * 
 * @param {Moment} mdate istanza di moment da cui partire
 * @param {Number} dayOfWeek indice del giorno della settimana (domencia = 0)
 * @returns mdate (aggiornata)
 */
function nextDay(dayOfWeek) {
    const today = moment();
    const curDayOfWeek = today.day();
    if (curDayOfWeek === dayOfWeek) {
        if (today.tz(TIMEZONE).hour() > TRASH_COLLECTION_HOUR) {
            return today.add(7, 'days');
        } else {
            return today;
        }
    } else if (curDayOfWeek < dayOfWeek) {
        return today.add(dayOfWeek - curDayOfWeek, 'days');
    } else {
        return today.add(7 - curDayOfWeek + dayOfWeek, 'days');
    }
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
        if (!listOfLists) {
            log('permissions are not defined');
            return null;
        }
        // cerco la lista con il nome richieto e lo stato attivo
        const list = listOfLists.lists.find(list => {
            return list.name === listName &&
                list.state === ACTIVE;
        });
        if (list) {
            log('list retrieved:', JSON.stringify(list));
            listId = list.listId;
            sessionHelper.set('todoListId', listId);
        } else {
            // creo una nuova lista
            const listObject = {
                name: listName,
                state: ACTIVE
            };
            const result = await listClient.createList(listObject);
            log('new list created', result);
            if (result) {
                listId = result.listId;
                sessionHelper.set('todoListId', listId);
            }
        }
    }
    log('... todoListId', listId);
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

async function getUserEmail(handlerInput) {
    const ups = handlerInput.serviceClientFactory.getUpsServiceClient();
    return ups.getProfileEmail();
}

async function sendListByMail(from, to) {
    const params = {
        Destination: {
            ToAddresses: [to]
        },
        Message: {
            Body: {
                Html: {
                    Charset: "UTF-8",
                    Data: "HTML_FORMAT_BODY"
                },
                Text: {
                    Charset: "UTF-8",
                    Data: "TEXT_FORMAT_BODY"
                }
            },
            Subject: {
                Charset: 'UTF-8',
                Data: 'Test email'
            }
        },
        Source: from,
        ReplyToAddresses: [
            from
        ],
    };

    log(`try sending mail: ${JSON.stringify(params)}`);
    return new AWS.SES({ apiVersion: '2010-12-01' })
        .sendEmail(params)
        .promise();
}

const LaunchRequestHandler = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === 'LaunchRequest';
    },
    handle(handlerInput) {
        return handlerInput.responseBuilder
            .speak(ospeak.phrase('Benvenuto, con questa skill puoi gestire i tuoi straordinari.',
                'Cosa vuoi fare?'))
            .reprompt('Per scoprire tutte le funzionalità di questa skill, prova a chiedere aiuto!')
            .getResponse();
    },
};

/**
 * Slots:
 * - {hours}  durata straordinario
 * - {preposition} non utilizzata
 * - {date} data
 * - {dayOfWeek}  giorno della settimana
 * 
 * TODO: togliere dayOfWeek
 */
const AddOvertimeIntent = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === 'IntentRequest'
            && handlerInput.requestEnvelope.request.intent.name === 'AddOvertimeIntent';
    },
    async handle(handlerInput) {
        const responseBuilder = handlerInput.responseBuilder;
        const attr = createSessionHelper(handlerInput);

        // prima di tutto recupero l'id della lista
        // un eventuale problema con i permessi viene intercettato da ErrorHandler
        // TODO: la creazione eventuale della lista impiega qualche secondo, provare a usare getDirectiveServiceClient
        const listId = await getListId(handlerInput, attr, LIST_NAME);
        if (!listId) {
            log('List id null!');
            responseBuilder
                .speak('Non sono riuscito a recuperare la lista.')
                .withShouldEndSession(true);
        } else {
            const filledSlots = handlerInput.requestEnvelope.request.intent.slots;
            const slotValues = getSlotValues(filledSlots);
            const dialogState = handlerInput.requestEnvelope.request.dialogState;
            const confirmationStatus = handlerInput.requestEnvelope.request.intent.confirmationStatus;

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
            // giorno settimana -> dayOfWeek (lunedì, martedì, etc.)

            // TODO: occorre gestire anche il passatto (ieri, giovedì scorso, etc)

            // cerco i parametri prima tra gli attributi di sessione
            let duration = attr.get('duration');
            let dates = attr.get('dates');

            log('AddOvertimeIntent', duration, dates, dialogState, confirmationStatus);

            try {
                // e cerco anche tra gli slot di richiesta
                // se manca uno dei due lo chiedo all'utente
                if (duration ||
                    (((duration = (slotValues.duration && slotValues.duration.resolved)) &&
                        (duration = parseDurationString(duration))))) {
                    attr.set('duration', duration);
                    if (dates ||
                        (((dates = ((slotValues.date && slotValues.date.resolved) || (slotValues.dayOfWeek && slotValues.dayOfWeek.resolved)))
                            && (dates = parseDateString(dates))))) {
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
            } catch (err) {
                log(`Error processing events request: ${err}`);
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

        // prima di tutto recupero l'id della lista
        // un eventuale problema con i permessi viene intercettato da ErrorHandler
        // TODO: è inutile creare la lista
        const listId = await getListId(handlerInput, attr, LIST_NAME);
        if (!listId) {
            log('List id null!');
            responseBuilder
                .speak('Non sono riuscito a recuperare la lista.')
                .withShouldEndSession(true);
        } else {
            const filledSlots = handlerInput.requestEnvelope.request.intent.slots;
            const slotValues = getSlotValues(filledSlots);
            const dialogState = handlerInput.requestEnvelope.request.dialogState;

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
            // giorno settimana -> dayOfWeek (lunedì, martedì, etc.)

            // TODO: occorre gestire anche il passatto (ieri, giovedì scorso, etc)

            // cerco i parametri prima tra gli attributi di sessione
            let dates = attr.get('dates');
            let months = attr.get('months');

            log('GetOvertimeIntent', dates, dialogState);

            try {
                // e cerco anche tra gli slot di richiesta
                // se date è un mese lo salvo nell'attributo months
                if (dates ||
                    ((dates = (slotValues.date && slotValues.date.resolved))
                        && (dates = parseDateString(dates)))) {
                    attr.set('dates', dates);
                    // TODO: recuperare elenco straordinari
                    responseBuilder
                        .speak(`Lista di ${dates.length} giorni`)
                        .withShouldEndSession(true);
                } else if (months ||
                    ((months = (slotValues.date && slotValues.date.resolved))
                        && (months = parseMonthString(months)))) {
                    attr.set('months', months);
                    // TODO: recuperare elenco straordinari
                    responseBuilder
                        .speak(`Lista di ${months.length} mesi`)
                        .withShouldEndSession(true);
                } else {
                    responseBuilder
                        .speak('Di quale giorno?')
                        .addElicitSlotDirective('date')
                        .withShouldEndSession(false);
                }
            } catch (err) {
                log(`Error processing events request: ${err}`);
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

        try {
            const email = await getUserEmail(handlerInput);
            if (email) {
                log(`Sending mail to ${email}`);
                // TODO: recuperare il contenuto della lista, formattarlo,
                //  e inviarlo via mail sia nel testo che come allegato CSV
                //  gli allegati possono essere inviati solo con sendRawEmail
                //  vedi https://stackoverflow.com/questions/49364199/how-can-send-pdf-attachment-in-node-aws-sdk-sendrawemail-function
                
                // TODO: è possibile inviare mail solo a indirizzi autorizzati e verificati
                //  per estendere a mail non autorizzate il servizio https://console.aws.amazon.com/support/v1?region=us-east-1#/case/create?issueType=service-limit-increase&limitType=service-code-ses                
                //  oppure si può provre con il metodo SES VerifyEmailIdentity 
                //  che dovrebbe inviare una mail di notifica/verifica ad un indirizzo
                //  il problema è che il template vuole due url per il redirect
                //  in caso di autorizzaione o rifiuto
                //  e a cosa faccio puntare questi url? io non ho un sito web!!!

                // NB: yahoo non permette l'invio di mail tramite SES, gmail sembra funzionare
                const response = await sendListByMail(skconfig['mail_recipe'], email);
                log(`response: ${JSON.stringify(response)}`);
                responseBuilder
                    .speak('Controlla nella tua casella mail.')
                    .withShouldEndSession(true)
            } else {
                responseBuilder
                    .speak('Non ci sono riuscito!')
                    .withShouldEndSession(true);
            }
        } catch (err) {
            log(`Error processing events request: ${err}`);
            log(JSON.stringify(handlerInput));
            responseBuilder
                .speak('Si è verificato un errore!');
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
        const speechText = 'Questo è un aiuto';

        return handlerInput.responseBuilder
            .speak(speechText)
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

const skillBuilder = Alexa.SkillBuilders.custom();

exports.handler = skillBuilder
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
