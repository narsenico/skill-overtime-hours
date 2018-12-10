/* eslint-disable  func-names */
/* eslint-disable  no-console */

/**
 * @name skill-overtime-hours
 * @author Caldi Gianfranco
 * @version 1.0.0
 */

const Alexa = require('ask-sdk-core');
const moment = require('moment-timezone');
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
    // fuso orario italia
    // TODO: recuperare la timezone 
    //  https://developer.amazon.com/docs/smapi/alexa-settings-api-reference.html#request
    //  access token e device id sono in handlerInput.requestEnvelope
    TIMEZONE = 'Europe/Rome';

const CONFIRM_NONE = 'NONE',
    CONFIRM_CONFIRMED = 'CONFIRMED',
    CONFIRM_DENIED = 'DENIED';

const listStatuses = {
    ACTIVE: 'active',
    COMPLETED: 'completed',
};

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

async function getListId(handlerInput, sessionHelper, listName) {
    // TODO: cercare la lista custom per questa skill
    log('getListId ...');
    let listId = sessionHelper.get('todoListId');
    // check session attributes to see if it has already been fetched
    if (!listId) {
        // lookup the id for the 'to do' list
        const listClient = handlerInput.serviceClientFactory.getListManagementServiceClient();
        const listOfLists = await listClient.getListsMetadata();
        if (!listOfLists) {
            log('permissions are not defined');
            return null;
        }
        // for (let i = 0; i < listOfLists.lists.length; i += 1) {
        //     log(`found ${listOfLists.lists[i].name} with id ${listOfLists.lists[i].listId}`);
        //     const decodedListId = Buffer.from(listOfLists.lists[i].listId, 'base64').toString('utf8');
        //     log(`decoded listId: ${decodedListId}`);
        //     // The default lists (To-Do and Shopping List) list_id values are base-64 encoded strings with these formats:
        //     //  <Internal_identifier>-TASK for the to-do list
        //     //  <Internal_identifier>-SHOPPING_LIST for the shopping list
        //     // Developers can base64 decode the list_id value and look for the specified string at the end. This string is constant and agnostic to localization.
        //     if (decodedListId.endsWith(listName)) {
        //         // since we're looking for the default to do list, it's always present and always active
        //         listId = listOfLists.lists[i].listId;
        //         break;
        //     }
        // }
        const list = listOfLists.lists.find(list => {
            return list.name === listName;
        });
        if (list) {
            // TODO: verificare: se la lista è archiviata (ma non cancellata) va in errore l'aggiunta
            //   immagino perché non posso aggiungere ad una lista archiviata
            listId = list.listId;
            sessionHelper.set('todoListId', listId);
        } else {
            // creo una nuova lista
            const listObject = {
                name: listName,
                state: 'active'
            };
            const result = await listClient.createList(listObject);
            log('created new list', result);
            if (result) {
                listId = result.listId;
                sessionHelper.set('todoListId', listId);
            }
        }
    }
    log('... todoListId', listId);
    return listId;
}

async function addToList(handlerInput, listId, duration, dates) {
    const listClient = handlerInput.serviceClientFactory.getListManagementServiceClient();
    const list = await listClient.getList(listId, listStatuses.ACTIVE);
    if (!list) {
        return false;
    } else {
        let len = list.items ? list.items.length : 0;
        let count = 0;
        log('addToList len:', len);
        // creo un item per ogni data
        for (const idx in dates) {
            const listItem = {
                // deve essere una stringa di massimo 256 caratteri
                // TODO: trovare un formato che sia leggibile (la lista è consultabile da app)
                //  ma di cui sia possibile il parsing
                // value: JSON.stringify({ prog: ++len, duration, date: dates[idx] }),
                value: `#${++len} ${dates[idx]}: ${duration} minuti`,
                status: listStatuses.ACTIVE
            };
            const result = await listClient.createListItem(listId, listItem);
            log('addToList', result);
            result && ++count;
        }
        log('addToList added', count);
        return count;
    }
}

const LaunchRequestHandler = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === 'LaunchRequest';
    },
    handle(handlerInput) {
        return handlerInput.responseBuilder
            .speak(ospeak.phrase('Benvenuto, con questa skill puoi gestire i tuoi straordinari.',
                'Cosa desideri fare?'))
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
 */
const AddOvertimeIntent = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === 'IntentRequest'
            && handlerInput.requestEnvelope.request.intent.name === 'AddOvertimeIntent';
    },
    async handle(handlerInput) {
        const responseBuilder = handlerInput.responseBuilder;
        const filledSlots = handlerInput.requestEnvelope.request.intent.slots;
        const slotValues = getSlotValues(filledSlots);
        const dialogState = handlerInput.requestEnvelope.request.dialogState;
        const confirmationStatus = handlerInput.requestEnvelope.request.intent.confirmationStatus;
        const attr = createSessionHelper(handlerInput);

        // prima di tutto recupero l'id della lista
        // TODO: senza i permessi ricevo un errore "forbidden" e non riesco a intercettarlo
        const listId = await getListId(handlerInput, attr, 'Straordinari');
        if (!listId) {
            // l'utente non ha i permessi
            const permissions = ['read::alexa:household:list', 'write::alexa:household:list'];
            responseBuilder
                .speak('Mancano i permessi.')
                .withAskForPermissionsConsentCard(permissions)
                .withShouldEndSession(true);
        } else {

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
                                if (result) {
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
                responseBuilder
                    .speak('Si è verificato un errore!');
            }
        }

        return responseBuilder
            .getResponse();
    },
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
        console.error(`Error handled: ${error.message}`);

        return handlerInput.responseBuilder
            .speak('Scusa, non ho capito.')
            .reprompt('Scusa, non ho capito.')
            .getResponse();
    },
};

const skillBuilder = Alexa.SkillBuilders.custom();

exports.handler = skillBuilder
    .addRequestHandlers(
        LaunchRequestHandler,
        AddOvertimeIntent,
        HelpIntentHandler,
        CancelAndStopIntentHandler,
        SessionEndedRequestHandler
    )
    .addErrorHandlers(ErrorHandler)
    .withApiClient(new Alexa.DefaultApiClient())
    .lambda();
