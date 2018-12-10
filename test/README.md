# TOC
   - [il mio straordinario](#il-mio-straordinario)
     - [Benvenuto](#il-mio-straordinario-benvenuto)
     - [Aggiungi 1 ora e 5 minuti a oggi](#il-mio-straordinario-aggiungi-1-ora-e-5-minuti-a-oggi)
     - [Giorno non specificato](#il-mio-straordinario-giorno-non-specificato)
<a name=""></a>
 
<a name="il-mio-straordinario"></a>
# il mio straordinario
<a name="il-mio-straordinario-benvenuto"></a>
## Benvenuto
returns the correct responses.

```js
var run = function (handler, sequenceIndex, attributes) {
	if (sequenceIndex >= sequence.length) {
		// all requests were executed
		done();
	}
	else {
		var ctx = awsContext(self.mockContextOptions);
		var currentItem = sequence[sequenceIndex];
		
		var request = currentItem.request;
		request.session.new = sequenceIndex === 0;
		if (attributes) {
			request.session.attributes = JSON.parse(JSON.stringify(attributes));
		} else {
			request.session.attributes = {};
		}
		request.session.sessionId = randomSessionId;
		var callback = function (err, result) {
			if (err) {
				return ctx.fail(err);
			}
			return ctx.succeed(result);
		};
		// adds values from withSessionAttributes to the session
		if (currentItem.withSessionAttributes) {
			var session = request.session.attributes;
			for (var newAttribute in currentItem.withSessionAttributes) {
				if (!session[newAttribute]) {
					session[newAttribute] = currentItem.withSessionAttributes[newAttribute];
				}
			}
		}
		
		var requestType = request.request.type;
		if (requestType === "IntentRequest") {
			requestType = request.request.intent.name;
		}
		var context = new CallbackContext(self, sequenceIndex, locale, requestType);
		
		if (self.dynamoDBTable) {
			self.dynamoDBGetMock = (params, callback) => {
				self._assertStringEqual(context, "TableName", params.TableName, self.dynamoDBTable);
				self._assertStringEqual(context, "UserId", params.Key[self.partitionKeyName], self.userId);
				
				const Item = {};
				Item[self.partitionKeyName] = self.userId;
				Item[self.attributesName] = currentItem.withStoredAttributes || {};
				callback(null, {TableName: self.dynamoDBTable, Item});
			};
			self.dynamoDBPutMock = (params, callback) => {
				self._assertStringEqual(context, "TableName", params.TableName, self.dynamoDBTable);
				self._assertStringEqual(context, "UserId", params.Item[self.partitionKeyName], self.userId);
				let storesAttributes = currentItem.storesAttributes;
				if (storesAttributes) {
					for (let att in storesAttributes) {
						if (storesAttributes.hasOwnProperty(att)) {
							const storedAttr = params.Item[self.attributesName][att];
							if (typeof storesAttributes[att] === "function") {
								if (!storesAttributes[att](storedAttr)) {
									context.assert({message: "the stored attribute " + att + " did not contain the correct value. Value was: " + storedAttr});
								}
							} else {
								self._assertStringEqual(context, att, storedAttr, storesAttributes[att]);
							}
						}
					}
				}
				callback(null, {});
			};
		}
		
		var result = handler(request, ctx, callback, true);
		if (result) {
			if (result.then) {
				result.then(ctx.succeed, ctx.fail);
			} else {
				ctx.succeed(result);
			}
		}
		
		ctx.Promise
			.then(response => {
				//TODO: null checks
				
				if (response.toJSON) {
					response = response.toJSON();
				}
				
				var actualSay = response.response && response.response.outputSpeech ? response.response.outputSpeech.ssml : undefined;
				var actualReprompt = response.response && response.response.reprompt && response.response.reprompt.outputSpeech ? response.response.reprompt.outputSpeech.ssml : undefined;
				
				// check the returned speech
				if (currentItem.says !== undefined) {
					self._assertStringPresent(context, 'speech', actualSay);
					var trimActualSay = actualSay.substring(7);
					trimActualSay = trimActualSay.substring(0, trimActualSay.length - 8).trim();
					if (Array.isArray(currentItem.says)) {
						self._assertStringOneOf(context, "speech", trimActualSay, currentItem.says);
					} else {
						self._assertStringEqual(context, "speech", trimActualSay, currentItem.says);
					}
				}
				if (currentItem.saysLike !== undefined) {
					self._assertStringContains(context, "speech", actualSay, currentItem.saysLike);
				}
				if (currentItem.saysNothing) {
					self._assertStringMissing(context, "speech", actualSay);
				}
				if (currentItem.reprompts !== undefined) {
					self._assertStringPresent(context, 'reprompt', actualReprompt);
					var trimActualReprompt = actualReprompt.substring(7);
					trimActualReprompt = trimActualReprompt.substring(0, trimActualReprompt.length - 8).trim();
					if (Array.isArray(currentItem.reprompts)) {
						self._assertStringOneOf(context, "reprompt", trimActualReprompt, currentItem.reprompts);
					} else {
						self._assertStringEqual(context, "reprompt", trimActualReprompt, currentItem.reprompts);
					}
				}
				if (currentItem.repromptsLike !== undefined) {
					self._assertStringContains(context, "reprompt", actualReprompt, currentItem.repromptsLike);
				}
				if (currentItem.repromptsNothing) {
					self._assertStringMissing(context, "reprompt", actualReprompt);
				}
				
				if (currentItem.elicitsSlot) {
					let elicitSlotDirective = self._getDirectiveFromResponse(response, 'Dialog.ElicitSlot');
					let slot = elicitSlotDirective ? elicitSlotDirective.slotToElicit : '';
					self._assertStringEqual(context, "elicitSlot", slot, currentItem.elicitsSlot);
				}
				
				if (currentItem.confirmsSlot) {
					let confirmSlotDirective = self._getDirectiveFromResponse(response, 'Dialog.ConfirmSlot');
					let slot = confirmSlotDirective ? confirmSlotDirective.slotToConfirm : '';
					self._assertStringEqual(context, "confirmSlot", slot, currentItem.confirmsSlot);
				}
				
				if (currentItem.confirmsIntent) {
					let confirmSlotDirective = self._getDirectiveFromResponse(response, 'Dialog.ConfirmIntent');
					if (!confirmSlotDirective) {
						context.assert({message: "the response did not ask Alexa to confirm the intent"});
					}
				}
				
				if (currentItem.hasAttributes) {
					for (let att in currentItem.hasAttributes) {
						if (currentItem.hasAttributes.hasOwnProperty(att)) {
							if (typeof currentItem.hasAttributes[att] === "function") {
								if (!currentItem.hasAttributes[att](response.sessionAttributes[att])) {
									context.assert({message: "the attribute " + att + " did not contain the correct value. Value was: " + response.sessionAttributes[att]});
								}
							} else {
								self._assertStringEqual(context, att, response.sessionAttributes[att], currentItem.hasAttributes[att]);
							}
						}
					}
				}
				
				if (currentItem.hasCardTitle) {
					if (!response.response.card) {
						context.assert({message: "the response did not contain a card"});
					} else {
						self._assertStringEqual(context, "cardTitle", response.response.card.title, currentItem.hasCardTitle);
					}
				}
				
				if (currentItem.hasCardContent) {
					if (!response.response.card) {
						context.assert({message: "the response did not contain a card"});
					} else if (response.response.card.type !== "Simple") {
						context.assert({ message: "the card in the response was not a simple card" });
					} else {
						self._assertStringEqual(context, "cardContent", response.response.card.content, currentItem.hasCardContent);
					}
				}
				if (currentItem.hasCardContentLike) {
					if (!response.response.card) {
						context.assert({ message: "the response did not contain a card" });
					} else if (response.response.card.type !== "Simple") {
						context.assert({ message: "the card in the response was not a simple card" });
					} else {
						self._assertStringContains(context, "cardContent", response.response.card.content, currentItem.hasCardContentLike);
					}
				}
				if (currentItem.hasCardText) {
					if (!response.response.card) {
						context.assert({ message: "the response did not contain a card" });
					} else if (response.response.card.type !== "Standard") {
						context.assert({ message: "the card in the response was not a standard card" });
					} else {
						self._assertStringEqual(context, "cardText", response.response.card.text, currentItem.hasCardText);
					}
				}
				if (currentItem.hasCardTextLike) {
					if (!response.response.card) {
						context.assert({ message: "the response did not contain a card" });
					} else if (response.response.card.type !== "Standard") {
						context.assert({ message: "the card in the response was not a standard card" });
					} else {
						self._assertStringContains(context, "cardText", response.response.card.text, currentItem.hasCardTextLike);
					}
				}
				if (currentItem.hasSmallImageUrlLike) {
					if (!response.response.card) {
						context.assert({ message: "the response did not contain a card" });
					} else if (response.response.card.type !== "Standard") {
						context.assert({ message: "the card in the response was not a standard card" });
					} else if (!response.response.card.image) {
						context.assert({ message: "the card in the response did not contain an image" });
					} else {
						self._assertStringContains(context, "smallImageUrl", response.response.card.image.smallImageUrl, currentItem.hasSmallImageUrlLike);
					}
				}
				if (currentItem.hasLargeImageUrlLike) {
					if (!response.response.card) {
						context.assert({ message: "the response did not contain a card" });
					} else if (response.response.card.type !== "Standard") {
						context.assert({ message: "the card in the response was not a standard card" });
					} else if (!response.response.card.image) {
						context.assert({ message: "the card in the response did not contain an image" });
					} else {
						self._assertStringContains(context, "largeImageUrl", response.response.card.image.largeImageUrl, currentItem.hasLargeImageUrlLike);
					}
				}
				// check the shouldEndSession flag
				if (currentItem.shouldEndSession === true && response.response.shouldEndSession === false) {
					context.assert(
						{
							message: "the response did not end the session",
							expected: "the response ends the session",
							actual: "the response did not end the session"
						});
				}
				else if (currentItem.shouldEndSession === false && response.response.shouldEndSession !== false) {
					context.assert(
						{
							message: "the response ended the session",
							expected: "the response does not end the session",
							actual: "the response ended the session"
						});
				}
				
				checkAudioPlayer(self, context, response, currentItem);
				
				// custom checks
				if (currentItem.saysCallback) {
					currentItem.saysCallback(context, actualSay);
				}
				if (currentItem.callback) {
					currentItem.callback(context, response);
				}
				
				// extra checks
				if (self.extraFeatures.questionMarkCheck) {
					context._questionMarkCheck(response);
				}
				
				run(handler, sequenceIndex + 1, response.sessionAttributes);
			})
			.catch(done);
	}
};
run(index.handler, 0, {});
```

<a name="il-mio-straordinario-aggiungi-1-ora-e-5-minuti-a-oggi"></a>
## Aggiungi 1 ora e 5 minuti a oggi
returns the correct responses.

```js
var run = function (handler, sequenceIndex, attributes) {
	if (sequenceIndex >= sequence.length) {
		// all requests were executed
		done();
	}
	else {
		var ctx = awsContext(self.mockContextOptions);
		var currentItem = sequence[sequenceIndex];
		
		var request = currentItem.request;
		request.session.new = sequenceIndex === 0;
		if (attributes) {
			request.session.attributes = JSON.parse(JSON.stringify(attributes));
		} else {
			request.session.attributes = {};
		}
		request.session.sessionId = randomSessionId;
		var callback = function (err, result) {
			if (err) {
				return ctx.fail(err);
			}
			return ctx.succeed(result);
		};
		// adds values from withSessionAttributes to the session
		if (currentItem.withSessionAttributes) {
			var session = request.session.attributes;
			for (var newAttribute in currentItem.withSessionAttributes) {
				if (!session[newAttribute]) {
					session[newAttribute] = currentItem.withSessionAttributes[newAttribute];
				}
			}
		}
		
		var requestType = request.request.type;
		if (requestType === "IntentRequest") {
			requestType = request.request.intent.name;
		}
		var context = new CallbackContext(self, sequenceIndex, locale, requestType);
		
		if (self.dynamoDBTable) {
			self.dynamoDBGetMock = (params, callback) => {
				self._assertStringEqual(context, "TableName", params.TableName, self.dynamoDBTable);
				self._assertStringEqual(context, "UserId", params.Key[self.partitionKeyName], self.userId);
				
				const Item = {};
				Item[self.partitionKeyName] = self.userId;
				Item[self.attributesName] = currentItem.withStoredAttributes || {};
				callback(null, {TableName: self.dynamoDBTable, Item});
			};
			self.dynamoDBPutMock = (params, callback) => {
				self._assertStringEqual(context, "TableName", params.TableName, self.dynamoDBTable);
				self._assertStringEqual(context, "UserId", params.Item[self.partitionKeyName], self.userId);
				let storesAttributes = currentItem.storesAttributes;
				if (storesAttributes) {
					for (let att in storesAttributes) {
						if (storesAttributes.hasOwnProperty(att)) {
							const storedAttr = params.Item[self.attributesName][att];
							if (typeof storesAttributes[att] === "function") {
								if (!storesAttributes[att](storedAttr)) {
									context.assert({message: "the stored attribute " + att + " did not contain the correct value. Value was: " + storedAttr});
								}
							} else {
								self._assertStringEqual(context, att, storedAttr, storesAttributes[att]);
							}
						}
					}
				}
				callback(null, {});
			};
		}
		
		var result = handler(request, ctx, callback, true);
		if (result) {
			if (result.then) {
				result.then(ctx.succeed, ctx.fail);
			} else {
				ctx.succeed(result);
			}
		}
		
		ctx.Promise
			.then(response => {
				//TODO: null checks
				
				if (response.toJSON) {
					response = response.toJSON();
				}
				
				var actualSay = response.response && response.response.outputSpeech ? response.response.outputSpeech.ssml : undefined;
				var actualReprompt = response.response && response.response.reprompt && response.response.reprompt.outputSpeech ? response.response.reprompt.outputSpeech.ssml : undefined;
				
				// check the returned speech
				if (currentItem.says !== undefined) {
					self._assertStringPresent(context, 'speech', actualSay);
					var trimActualSay = actualSay.substring(7);
					trimActualSay = trimActualSay.substring(0, trimActualSay.length - 8).trim();
					if (Array.isArray(currentItem.says)) {
						self._assertStringOneOf(context, "speech", trimActualSay, currentItem.says);
					} else {
						self._assertStringEqual(context, "speech", trimActualSay, currentItem.says);
					}
				}
				if (currentItem.saysLike !== undefined) {
					self._assertStringContains(context, "speech", actualSay, currentItem.saysLike);
				}
				if (currentItem.saysNothing) {
					self._assertStringMissing(context, "speech", actualSay);
				}
				if (currentItem.reprompts !== undefined) {
					self._assertStringPresent(context, 'reprompt', actualReprompt);
					var trimActualReprompt = actualReprompt.substring(7);
					trimActualReprompt = trimActualReprompt.substring(0, trimActualReprompt.length - 8).trim();
					if (Array.isArray(currentItem.reprompts)) {
						self._assertStringOneOf(context, "reprompt", trimActualReprompt, currentItem.reprompts);
					} else {
						self._assertStringEqual(context, "reprompt", trimActualReprompt, currentItem.reprompts);
					}
				}
				if (currentItem.repromptsLike !== undefined) {
					self._assertStringContains(context, "reprompt", actualReprompt, currentItem.repromptsLike);
				}
				if (currentItem.repromptsNothing) {
					self._assertStringMissing(context, "reprompt", actualReprompt);
				}
				
				if (currentItem.elicitsSlot) {
					let elicitSlotDirective = self._getDirectiveFromResponse(response, 'Dialog.ElicitSlot');
					let slot = elicitSlotDirective ? elicitSlotDirective.slotToElicit : '';
					self._assertStringEqual(context, "elicitSlot", slot, currentItem.elicitsSlot);
				}
				
				if (currentItem.confirmsSlot) {
					let confirmSlotDirective = self._getDirectiveFromResponse(response, 'Dialog.ConfirmSlot');
					let slot = confirmSlotDirective ? confirmSlotDirective.slotToConfirm : '';
					self._assertStringEqual(context, "confirmSlot", slot, currentItem.confirmsSlot);
				}
				
				if (currentItem.confirmsIntent) {
					let confirmSlotDirective = self._getDirectiveFromResponse(response, 'Dialog.ConfirmIntent');
					if (!confirmSlotDirective) {
						context.assert({message: "the response did not ask Alexa to confirm the intent"});
					}
				}
				
				if (currentItem.hasAttributes) {
					for (let att in currentItem.hasAttributes) {
						if (currentItem.hasAttributes.hasOwnProperty(att)) {
							if (typeof currentItem.hasAttributes[att] === "function") {
								if (!currentItem.hasAttributes[att](response.sessionAttributes[att])) {
									context.assert({message: "the attribute " + att + " did not contain the correct value. Value was: " + response.sessionAttributes[att]});
								}
							} else {
								self._assertStringEqual(context, att, response.sessionAttributes[att], currentItem.hasAttributes[att]);
							}
						}
					}
				}
				
				if (currentItem.hasCardTitle) {
					if (!response.response.card) {
						context.assert({message: "the response did not contain a card"});
					} else {
						self._assertStringEqual(context, "cardTitle", response.response.card.title, currentItem.hasCardTitle);
					}
				}
				
				if (currentItem.hasCardContent) {
					if (!response.response.card) {
						context.assert({message: "the response did not contain a card"});
					} else if (response.response.card.type !== "Simple") {
						context.assert({ message: "the card in the response was not a simple card" });
					} else {
						self._assertStringEqual(context, "cardContent", response.response.card.content, currentItem.hasCardContent);
					}
				}
				if (currentItem.hasCardContentLike) {
					if (!response.response.card) {
						context.assert({ message: "the response did not contain a card" });
					} else if (response.response.card.type !== "Simple") {
						context.assert({ message: "the card in the response was not a simple card" });
					} else {
						self._assertStringContains(context, "cardContent", response.response.card.content, currentItem.hasCardContentLike);
					}
				}
				if (currentItem.hasCardText) {
					if (!response.response.card) {
						context.assert({ message: "the response did not contain a card" });
					} else if (response.response.card.type !== "Standard") {
						context.assert({ message: "the card in the response was not a standard card" });
					} else {
						self._assertStringEqual(context, "cardText", response.response.card.text, currentItem.hasCardText);
					}
				}
				if (currentItem.hasCardTextLike) {
					if (!response.response.card) {
						context.assert({ message: "the response did not contain a card" });
					} else if (response.response.card.type !== "Standard") {
						context.assert({ message: "the card in the response was not a standard card" });
					} else {
						self._assertStringContains(context, "cardText", response.response.card.text, currentItem.hasCardTextLike);
					}
				}
				if (currentItem.hasSmallImageUrlLike) {
					if (!response.response.card) {
						context.assert({ message: "the response did not contain a card" });
					} else if (response.response.card.type !== "Standard") {
						context.assert({ message: "the card in the response was not a standard card" });
					} else if (!response.response.card.image) {
						context.assert({ message: "the card in the response did not contain an image" });
					} else {
						self._assertStringContains(context, "smallImageUrl", response.response.card.image.smallImageUrl, currentItem.hasSmallImageUrlLike);
					}
				}
				if (currentItem.hasLargeImageUrlLike) {
					if (!response.response.card) {
						context.assert({ message: "the response did not contain a card" });
					} else if (response.response.card.type !== "Standard") {
						context.assert({ message: "the card in the response was not a standard card" });
					} else if (!response.response.card.image) {
						context.assert({ message: "the card in the response did not contain an image" });
					} else {
						self._assertStringContains(context, "largeImageUrl", response.response.card.image.largeImageUrl, currentItem.hasLargeImageUrlLike);
					}
				}
				// check the shouldEndSession flag
				if (currentItem.shouldEndSession === true && response.response.shouldEndSession === false) {
					context.assert(
						{
							message: "the response did not end the session",
							expected: "the response ends the session",
							actual: "the response did not end the session"
						});
				}
				else if (currentItem.shouldEndSession === false && response.response.shouldEndSession !== false) {
					context.assert(
						{
							message: "the response ended the session",
							expected: "the response does not end the session",
							actual: "the response ended the session"
						});
				}
				
				checkAudioPlayer(self, context, response, currentItem);
				
				// custom checks
				if (currentItem.saysCallback) {
					currentItem.saysCallback(context, actualSay);
				}
				if (currentItem.callback) {
					currentItem.callback(context, response);
				}
				
				// extra checks
				if (self.extraFeatures.questionMarkCheck) {
					context._questionMarkCheck(response);
				}
				
				run(handler, sequenceIndex + 1, response.sessionAttributes);
			})
			.catch(done);
	}
};
run(index.handler, 0, {});
```

<a name="il-mio-straordinario-giorno-non-specificato"></a>
## Giorno non specificato
returns the correct responses.

```js
var run = function (handler, sequenceIndex, attributes) {
	if (sequenceIndex >= sequence.length) {
		// all requests were executed
		done();
	}
	else {
		var ctx = awsContext(self.mockContextOptions);
		var currentItem = sequence[sequenceIndex];
		
		var request = currentItem.request;
		request.session.new = sequenceIndex === 0;
		if (attributes) {
			request.session.attributes = JSON.parse(JSON.stringify(attributes));
		} else {
			request.session.attributes = {};
		}
		request.session.sessionId = randomSessionId;
		var callback = function (err, result) {
			if (err) {
				return ctx.fail(err);
			}
			return ctx.succeed(result);
		};
		// adds values from withSessionAttributes to the session
		if (currentItem.withSessionAttributes) {
			var session = request.session.attributes;
			for (var newAttribute in currentItem.withSessionAttributes) {
				if (!session[newAttribute]) {
					session[newAttribute] = currentItem.withSessionAttributes[newAttribute];
				}
			}
		}
		
		var requestType = request.request.type;
		if (requestType === "IntentRequest") {
			requestType = request.request.intent.name;
		}
		var context = new CallbackContext(self, sequenceIndex, locale, requestType);
		
		if (self.dynamoDBTable) {
			self.dynamoDBGetMock = (params, callback) => {
				self._assertStringEqual(context, "TableName", params.TableName, self.dynamoDBTable);
				self._assertStringEqual(context, "UserId", params.Key[self.partitionKeyName], self.userId);
				
				const Item = {};
				Item[self.partitionKeyName] = self.userId;
				Item[self.attributesName] = currentItem.withStoredAttributes || {};
				callback(null, {TableName: self.dynamoDBTable, Item});
			};
			self.dynamoDBPutMock = (params, callback) => {
				self._assertStringEqual(context, "TableName", params.TableName, self.dynamoDBTable);
				self._assertStringEqual(context, "UserId", params.Item[self.partitionKeyName], self.userId);
				let storesAttributes = currentItem.storesAttributes;
				if (storesAttributes) {
					for (let att in storesAttributes) {
						if (storesAttributes.hasOwnProperty(att)) {
							const storedAttr = params.Item[self.attributesName][att];
							if (typeof storesAttributes[att] === "function") {
								if (!storesAttributes[att](storedAttr)) {
									context.assert({message: "the stored attribute " + att + " did not contain the correct value. Value was: " + storedAttr});
								}
							} else {
								self._assertStringEqual(context, att, storedAttr, storesAttributes[att]);
							}
						}
					}
				}
				callback(null, {});
			};
		}
		
		var result = handler(request, ctx, callback, true);
		if (result) {
			if (result.then) {
				result.then(ctx.succeed, ctx.fail);
			} else {
				ctx.succeed(result);
			}
		}
		
		ctx.Promise
			.then(response => {
				//TODO: null checks
				
				if (response.toJSON) {
					response = response.toJSON();
				}
				
				var actualSay = response.response && response.response.outputSpeech ? response.response.outputSpeech.ssml : undefined;
				var actualReprompt = response.response && response.response.reprompt && response.response.reprompt.outputSpeech ? response.response.reprompt.outputSpeech.ssml : undefined;
				
				// check the returned speech
				if (currentItem.says !== undefined) {
					self._assertStringPresent(context, 'speech', actualSay);
					var trimActualSay = actualSay.substring(7);
					trimActualSay = trimActualSay.substring(0, trimActualSay.length - 8).trim();
					if (Array.isArray(currentItem.says)) {
						self._assertStringOneOf(context, "speech", trimActualSay, currentItem.says);
					} else {
						self._assertStringEqual(context, "speech", trimActualSay, currentItem.says);
					}
				}
				if (currentItem.saysLike !== undefined) {
					self._assertStringContains(context, "speech", actualSay, currentItem.saysLike);
				}
				if (currentItem.saysNothing) {
					self._assertStringMissing(context, "speech", actualSay);
				}
				if (currentItem.reprompts !== undefined) {
					self._assertStringPresent(context, 'reprompt', actualReprompt);
					var trimActualReprompt = actualReprompt.substring(7);
					trimActualReprompt = trimActualReprompt.substring(0, trimActualReprompt.length - 8).trim();
					if (Array.isArray(currentItem.reprompts)) {
						self._assertStringOneOf(context, "reprompt", trimActualReprompt, currentItem.reprompts);
					} else {
						self._assertStringEqual(context, "reprompt", trimActualReprompt, currentItem.reprompts);
					}
				}
				if (currentItem.repromptsLike !== undefined) {
					self._assertStringContains(context, "reprompt", actualReprompt, currentItem.repromptsLike);
				}
				if (currentItem.repromptsNothing) {
					self._assertStringMissing(context, "reprompt", actualReprompt);
				}
				
				if (currentItem.elicitsSlot) {
					let elicitSlotDirective = self._getDirectiveFromResponse(response, 'Dialog.ElicitSlot');
					let slot = elicitSlotDirective ? elicitSlotDirective.slotToElicit : '';
					self._assertStringEqual(context, "elicitSlot", slot, currentItem.elicitsSlot);
				}
				
				if (currentItem.confirmsSlot) {
					let confirmSlotDirective = self._getDirectiveFromResponse(response, 'Dialog.ConfirmSlot');
					let slot = confirmSlotDirective ? confirmSlotDirective.slotToConfirm : '';
					self._assertStringEqual(context, "confirmSlot", slot, currentItem.confirmsSlot);
				}
				
				if (currentItem.confirmsIntent) {
					let confirmSlotDirective = self._getDirectiveFromResponse(response, 'Dialog.ConfirmIntent');
					if (!confirmSlotDirective) {
						context.assert({message: "the response did not ask Alexa to confirm the intent"});
					}
				}
				
				if (currentItem.hasAttributes) {
					for (let att in currentItem.hasAttributes) {
						if (currentItem.hasAttributes.hasOwnProperty(att)) {
							if (typeof currentItem.hasAttributes[att] === "function") {
								if (!currentItem.hasAttributes[att](response.sessionAttributes[att])) {
									context.assert({message: "the attribute " + att + " did not contain the correct value. Value was: " + response.sessionAttributes[att]});
								}
							} else {
								self._assertStringEqual(context, att, response.sessionAttributes[att], currentItem.hasAttributes[att]);
							}
						}
					}
				}
				
				if (currentItem.hasCardTitle) {
					if (!response.response.card) {
						context.assert({message: "the response did not contain a card"});
					} else {
						self._assertStringEqual(context, "cardTitle", response.response.card.title, currentItem.hasCardTitle);
					}
				}
				
				if (currentItem.hasCardContent) {
					if (!response.response.card) {
						context.assert({message: "the response did not contain a card"});
					} else if (response.response.card.type !== "Simple") {
						context.assert({ message: "the card in the response was not a simple card" });
					} else {
						self._assertStringEqual(context, "cardContent", response.response.card.content, currentItem.hasCardContent);
					}
				}
				if (currentItem.hasCardContentLike) {
					if (!response.response.card) {
						context.assert({ message: "the response did not contain a card" });
					} else if (response.response.card.type !== "Simple") {
						context.assert({ message: "the card in the response was not a simple card" });
					} else {
						self._assertStringContains(context, "cardContent", response.response.card.content, currentItem.hasCardContentLike);
					}
				}
				if (currentItem.hasCardText) {
					if (!response.response.card) {
						context.assert({ message: "the response did not contain a card" });
					} else if (response.response.card.type !== "Standard") {
						context.assert({ message: "the card in the response was not a standard card" });
					} else {
						self._assertStringEqual(context, "cardText", response.response.card.text, currentItem.hasCardText);
					}
				}
				if (currentItem.hasCardTextLike) {
					if (!response.response.card) {
						context.assert({ message: "the response did not contain a card" });
					} else if (response.response.card.type !== "Standard") {
						context.assert({ message: "the card in the response was not a standard card" });
					} else {
						self._assertStringContains(context, "cardText", response.response.card.text, currentItem.hasCardTextLike);
					}
				}
				if (currentItem.hasSmallImageUrlLike) {
					if (!response.response.card) {
						context.assert({ message: "the response did not contain a card" });
					} else if (response.response.card.type !== "Standard") {
						context.assert({ message: "the card in the response was not a standard card" });
					} else if (!response.response.card.image) {
						context.assert({ message: "the card in the response did not contain an image" });
					} else {
						self._assertStringContains(context, "smallImageUrl", response.response.card.image.smallImageUrl, currentItem.hasSmallImageUrlLike);
					}
				}
				if (currentItem.hasLargeImageUrlLike) {
					if (!response.response.card) {
						context.assert({ message: "the response did not contain a card" });
					} else if (response.response.card.type !== "Standard") {
						context.assert({ message: "the card in the response was not a standard card" });
					} else if (!response.response.card.image) {
						context.assert({ message: "the card in the response did not contain an image" });
					} else {
						self._assertStringContains(context, "largeImageUrl", response.response.card.image.largeImageUrl, currentItem.hasLargeImageUrlLike);
					}
				}
				// check the shouldEndSession flag
				if (currentItem.shouldEndSession === true && response.response.shouldEndSession === false) {
					context.assert(
						{
							message: "the response did not end the session",
							expected: "the response ends the session",
							actual: "the response did not end the session"
						});
				}
				else if (currentItem.shouldEndSession === false && response.response.shouldEndSession !== false) {
					context.assert(
						{
							message: "the response ended the session",
							expected: "the response does not end the session",
							actual: "the response ended the session"
						});
				}
				
				checkAudioPlayer(self, context, response, currentItem);
				
				// custom checks
				if (currentItem.saysCallback) {
					currentItem.saysCallback(context, actualSay);
				}
				if (currentItem.callback) {
					currentItem.callback(context, response);
				}
				
				// extra checks
				if (self.extraFeatures.questionMarkCheck) {
					context._questionMarkCheck(response);
				}
				
				run(handler, sequenceIndex + 1, response.sessionAttributes);
			})
			.catch(done);
	}
};
run(index.handler, 0, {});
```

