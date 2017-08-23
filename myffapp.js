#!/usr/bin/node

var http = require('http'),
    fs = require('fs'),
    mongo = require('mongodb'),
    MongoClient = mongo.MongoClient,
    assert = require('assert');
const url = require("url");
const querystring = require("querystring");
var Gettext = require("node-gettext");
var gt = new Gettext();
var english = fs.readFileSync("./locales/en-GB/messages.pot");
var italian = fs.readFileSync("./locales/it-IT/messages.pot");
gt.addTextdomain("en-GB", english);
gt.addTextdomain("it-IT", italian);
var settings = require('./helpers/user-settings').file('./conf/userconf.json');
var eventclient = require("./helpers/eventclient");
var queryfeedclient = require('./helpers/queryfeedclient.js');
//TODO 
var previous_action = "";


/**
 * \class myffapp
 * \version 0.2.0
 * \date december 2016
 * \author christos kouroupetroglou
 */


function myffapp() {
    this.marvin = new eventclient(settings.get("marvin_ip"), settings.get("marvin_port"));
    this.topic = "myff";
    // this.topic = "myff";
    this.subscriber = "myff_app";
    // this.subscriber = "myff_app";
    this.resources = ["UI"];
    this.resources_topics = ["UIEvents", "UCEvents"];
    // this.locale = "en-GB";
    this.username = "Lazaros";
    this.profiles = settings.get("defaultprofiles");
    this.hashtag = settings.get("hashtag");
    this.ui_subscribed = false;
    this.img_folder = "./img";

    this.crawler = new queryfeedclient();
}

/**
 * \brief initialization steps the app must follow when the start message from the task manager comes
 *        register for news topic, create as needed
 * \param resources (optional) is an array of stings with the resources that required the app, so the app
 *        needs to subscribe to their topics.
 */
myffapp.prototype.init = function (resources) {
    var self = this;


    self.marvin.get_topics(function (json) {
        var exists = false;
        var topics = [];
        try {
            topics = JSON.parse(json);
        } catch (e) {
            console.log('init/parse error: ' + e);
            console.log(json);
        }
        for (var i = 0; i < topics.length; i++) {
            if (topics[i] === self.topic) {
                exists = true;
            }
        }
        if (!exists) {
            self.marvin.new_topic(self.topic, function (ok) {
                if (ok) {
                    console.log(self.topic + ' created successfully.');
                } else {
                    console.log('failed to create topic: ' + self.topic + ' aborting...');
                    return;
                }
            });
        } else {
            //          throw self.topic + ' existed already.';
            console.log(self.topic + ' existed already.');
        }
    });
}


/**
 * \brief initialization steps the app must follow when the message from the task manager saying that he is 
 *        subscribed to the app's topic comes. The app replies with the components it requires to work properly.
 * \param id Task manager subscribed message id, in order to be used as correlation id to the reply message.
 */
myffapp.prototype.start = function (id) {
    var self = this;

    // post message with the resources the app requires for the task manager to consume it and start them
    var json = {};
    json.correlationId = id;
    var body = {};
    body.targets = ["taskmanager"];
    body.resources = self.resources;
    json.body = JSON.stringify(body);
    self.post(json,
        function () {
            console.log("successfully posted: " + JSON.stringify(json));
        },
        function (error) {
            console.log("post failed: " + JSON.stringify(json) + "\nerror code: " + error);
        });

    // try to subscribe to all topics of the required resources in order to be able to use them
    if (self.resources_topics.length) {
        self.marvin.get_topics(function (json) {
            for (i = 0; i < self.resources_topics.length; i++) {
                self.search_n_sub(self.resources_topics[i], json);
            }
        });
    }

    // post message asking the UI for the required config parameters and wait for a reply to get these
    // parameters and to know that the UI subscribed in the app's topic
    // message format { "action" : "sendconfig",
    //                  "configs" : ["username", "locale", "news_topics"] }
    json = {};
    var body = {};
    body.targets = ["UI"];
    body.action = "sendconfig";
    body.configs = ["username", "locale"];
    json.body = JSON.stringify(body);
    self.post(json,
        function () {
            console.log("successfully posted: " + JSON.stringify(json));
        },
        function (error) {
            console.log("post failed: " + JSON.stringify(json) + "\nerror code: " + error);
        });
    var interval = setInterval(function () {
        if (self.ui_subscribed === true) {
            clearInterval(interval);
            return;
        }
        self.post(json,
            function () {
                console.log("successfully posted: " + JSON.stringify(json));
            },
            function (error) {
                console.log("post failed: " + JSON.stringify(json) + "\nerror code: " + error);
            });
    }, 1000);
}


/**
 * \brief initialization steps the app must follow when the message from the task manager asking it to stop comes.
 *        The app unsubscribes from all topics except taskmanager, posts a message that it stopped and deletes
 *        its topic.
 * \param id Task manager subscribed message id, in order to be used as correlation id to the reply message.
 */
myffapp.prototype.stop = function (id) {
    var self = this;

    if (self.resources_topics.length) {
        for (i = 0; i < self.resources_topics.length; i++) {
            var current_topic;
            self.marvin.unsubscribe(current_topic = self.resources_topics[i], self.subscriber, function (ok) {
                if (ok) {
                    console.log(self.subscriber + ' successfully unsubscribed from topic ' + current_topic);
                } else {
                    throw self.subscriber + ' failed to unsubscribe from topic: ' + current_topic;
                }
            });
        }
    }

    var json = {};
    json.correlationId = id;
    var body = {};
    //    body.targets = ["taskmanager"];
    body.state = "stopped";
    json.body = JSON.stringify(body);
    self.post(json,
        function () {
            console.log("successfully posted: " + JSON.stringify(json));
            // The message that the app stopped was sent successfully, so now we can delete the topic
            self.marvin.del_topic(self.topic, function (ok) {
                if (ok) {
                    console.log(self.topic + ' deleted successfully.');
                    self.ui_subscribed = false;
                    //TODO
                    previous_action = "";
                } else {
                    throw 'failed to delete topic: ' + self.topic + ' aborting...';
                }
            });
        },
        function (error) {
            console.log("post failed: " + JSON.stringify(json) + "\nerror code: " + error);
        });
}


/// \brief publish a message to the topic of the app after ensuring its existence
/// \param json the json object to be passed to eventclient.publish in order to be posted
myffapp.prototype.post = function (json, on_success, on_failure) {
    var self = this;

    self.marvin.get_topics(function (topics_json) {
        var exists = false;
        var topics = [];
        try {
            topics = JSON.parse(topics_json);
        } catch (e) {
            console.log('init/parse error: ' + e);
            console.log(topics_json);
        }
        for (var i = 0; i < topics.length; i++) {
            if (topics[i] === self.topic) {
                exists = true;
            }
        }
        if (exists) {
            self.marvin.publish(self.topic, json, on_success, on_failure);
        } else {
            throw self.topic + " no longer exists.";
        }
    });
};


/**
 * \brief process a new message and pass it to the appropriate function depending on who sent it
 */
myffapp.prototype.msg_proc = function (message, topic) {
    var self = this;

    // split the message into an array using the newline(s)
    var list = message.split("\n\n").filter(function (el) {
        return el.length !== 0;
    });
    // get the last message from the marvin queue
    var last = list[list.length - 1];
    // remove the first 6 characters (`data =`)
    message = last.substring(6);
    var data = null;

    // parse message
    try {
        var data = JSON.parse(message);
    } catch (e) {
        console.log('parse error: ' + e);
        console.log(message);
    }
    if (topic === "taskmanager") {
        self.tm_msg(data);
    } else if (topic === "UIEvents" || topic === "UCEvents") {
        self.ui_msg(data);
    }
}


/**
 * \brief process and take proper action concerning messages from the taskmanager topic
 * \param data the data property of the message.
 */
myffapp.prototype.tm_msg = function (data) {
    var self = this;

    if (data.hasOwnProperty("messageId")) {
        var msg_id = data.messageId;
    }

    if (data.hasOwnProperty("body")) {
        var body = JSON.parse(data.body);
        if (body.hasOwnProperty("ability") && (body.ability === self.topic)) {
            if (body.hasOwnProperty("command")) {
                if ((body.command === "start") && !body.hasOwnProperty("resources")) {
                    self.init();
                } else if ((body.command === "start") && body.hasOwnProperty("resources")) {
                    self.init(body.resources);
                } else if (body.command === "stop") {
                    self.stop(msg_id);
                }
            } else if (body.hasOwnProperty("state")) {
                if (body.state === "subscribed") {
                    self.start(msg_id);
                } else if (body.state !== "running") {
                    console.log("Wrong message format. Unknown state.");
                }
            } else {
                console.log("Wrong message format. No command or state.");
            }
        }
    } else {
        console.log('Wrong message format. No `body` found.');
    }
}

/**
 * \brief process and take proper action concerning messages from the UIEvents topic
 * \param data the data property of the message.
 */
myffapp.prototype.ui_msg = function (data) {
    var self = this;

    if (data.hasOwnProperty("body")) {
        var body = JSON.parse(data.body);

        // check JSON format and members 
        //        if (body.hasOwnProperty("event") && body.hasOwnProperty("ability") && (body.ability === self.topic))
        if (body.hasOwnProperty("ability") && (body.ability === self.topic)) {
            //            if (body.event === "touch" || body.event === "speak")
            //            {
            if (body.hasOwnProperty("action")) {
                var act_url = url.parse(body.action);
                var action = act_url.pathname;
                var act_params = querystring.parse(act_url.query);
                if (action === "homescreen") {
                    //TODO 
                    previous_action = "";
                    // showhome(self);
                    // show friends and family instead of homescreen
                    MongoClient.connect(settings.get("mongodb"), function (err, db) {
                        assert.equal(null, err);
                        console.log("Connected successfully to the db server");

                        self.db_find_topics(db, self.username, function (docs) {
                            showff(docs, self);

                            db.close();
                        });
                    });
                } else if (action === "selecttopic") {
                    MongoClient.connect(settings.get("mongodb"), function (err, db) {
                        assert.equal(null, err);
                        console.log("Connected successfully to the db server");

                        self.db_find_topics(db, self.username, function (docs) {
                            showff(docs, self);

                            db.close();
                        });
                    });
                } else if (action === "showheadlines") {
                    showheadlines(self, act_params);

                }
            }
            if (body.event === "config") {
                self.ui_subscribed = true;
                if (body.hasOwnProperty("locale")) {
                    self.locale = body.locale;
                }
                if (body.hasOwnProperty("username")) {
                    self.username = body.username;
                    var users = settings.get("users");
                    for (var u in users) {
                        if (users[u].name == self.username) {
                            self.profiles = users[u].profiles;
                            self.hashtag = users[u].hashtag;

                            MongoClient.connect(settings.get("mongodb"), function (err, db) {
                                assert.equal(null, err);
                                console.log("Connected successfully to the db server");
                                var collection = db.collection("users");
                                collection.updateOne({
                                        "user": self.username
                                    }, {
                                        "user": self.username,
                                        "profiles": self.profiles,
                                        "hashtag": self.hashtag
                                    }, {
                                        upsert: true
                                    },
                                    function () {
                                        db.close();
                                    }
                                );
                            });
                        } //end if
                    } //end for
                }
                // showhome(self);

                // show friends and family instead of homescreen
                MongoClient.connect(settings.get("mongodb"), function (err, db) {
                    assert.equal(null, err);
                    console.log("Connected successfully to the db server");

                    self.db_find_topics(db, self.username, function (docs) {
                        showff(docs, self);

                        db.close();
                    });
                });
            }
        }
    } else {
        console.log('Wrong message format. No `body` found.');
    }
}


function addnewsitems(news, self, body, json, headlines) {
    for (var i = 0; i < news.length; i++) {
        if (i >= 20)
            break;
        var temp = {};
        temp.title = news[i].title;
        // temp.img = "/_img/mario/news/" + ".png";
        temp.author = news[i].author;
        temp.published = news[i].published;
        // temp.action = "showarticle?id=" + news[i]._id;
        temp.keywords = news[i].title.split(" ");
        headlines.push(temp);
    }

    body.headlines = headlines;
    json.body = JSON.stringify(body);
    self.post(json,
        function () {
            console.log("successfully posted: " + JSON.stringify(json));
        },
        function (error) {
            console.log("post failed: " + JSON.stringify(json) + "\nerror code: " + error);
        });
    // db.close();
}

function showhome(self) {
    var json = {};
    var body = {};
    body.targets = ["UI"];
    body.action = "showoptions";
    body.heading = gt.dgettext(self.locale, "What would you like to do?");
    //TODO 
    // if (previous_action !== "") {
    //     body.back_action = previous_action;
    // }
    body.back_action = "";
    var options = [];

    var temp = {};
    temp.name = gt.dgettext(self.locale, "Read all headlines?");
    temp.img = "/_img/mario/Family-icon.png";
    temp.action = "showheadlines";
    temp.keywords = gt.dgettext(self.locale, "all_headlines_keywords").split(', ');
    options.push(temp);

    temp = {};
    temp.name = gt.dgettext(self.locale, "Select a topic of news?");
    temp.img = "/_img/mario/person-icon.png";
    temp.action = "selecttopic";
    temp.keywords = gt.dgettext(self.locale, "select_topic_keywords").split(', ');
    options.push(temp);

    body.options = options;
    json.body = JSON.stringify(body);

    self.post(json,
        function () {
            console.log("successfully posted: " + JSON.stringify(json));
        },
        function (error) {
            console.log("post failed: " + JSON.stringify(json) + "\nerror code: " + error);
        });
    //TODO 
    previous_action = "homescreen";
}

function showff(docs, self) {
    // var self = this;

    var json = {};
    var body = {};
    body.targets = ["UI"];
    body.action = "showoptions";
    //TODO 
    // if (previous_action !== "") {
    //     body.back_action = previous_action;
    // }
    // body.back_action = "homescreen";
    body.back_action = "";
    
    body.heading = gt.dgettext(self.locale, "Which topic would you like to read about?");
    // Christos changing to get topics image name and handle

    var profiles = docs.profiles;
    var options = [];
    for (var i = 0; i < profiles.length; i++) {
        var temp = {};
        temp.name = profiles[i].name + "? ";
        temp.img = profiles[i].img;
        temp.action = "showheadlines?handle=" + profiles[i].handle;
        temp.keywords = profiles[i].name;
        options.push(temp);
    }
    body.options = options;

    json.body = JSON.stringify(body);

    self.post(json,
        function () {
            console.log("successfully posted: " + JSON.stringify(json));
        },
        function (error) {
            console.log("post failed: " + JSON.stringify(json) + "\nerror code: " + error);
        });
    //TODO 
    previous_action = "selecttopic";
}

function showheadlines(self, act_params) {
    var search = act_params["handle"];
    var actual_keywords = [];
    actual_keywords.push(act_params["handle"]);

    var json = {};
    var body = {};
    body.targets = ["UI"];
    body.action = "showheadlines";
    body.heading = gt.dgettext(self.locale, "News headlines");
    //TODO 
    if (previous_action !== "") {
        body.back_action = previous_action;
    }
    // body.back_action = "homescreen";

    var headlines = [];
    // NOTE - multiple published messages **may** be provided
    //      - Marvin seems to have a BUG with large text.
    //        when I strip from news the content I get no errors.
    if (search) {
        self.crawler.search(search, self.hashtag /*settings.get("hashtag")*/ , self.locale,
            function (news) {
                MongoClient.connect(settings.get("mongodb"), function (err, db) {
                    assert.equal(null, err);
                    console.log("Connected successfully to the db server");
                    var ins_obj = {};
                    ins_obj.news = news;

                    if (news.length > 0) {
                        self.db_upsert(db, ins_obj, function () {
                            self.db_find_news(db, search, self.locale, function (news) {
                                addnewsitems(news, self, body, json, headlines);
                                db.close();
                            });
                        });
                    } else {
                        self.db_find_news(db, search, self.locale, function (news) {
                            addnewsitems(news, self, body, json, headlines);
                            db.close();
                        });
                    }

                });

            },
            function (error) {
                console.log(error);
                MongoClient.connect(settings.get("mongodb"), function (err, db) {
                    assert.equal(null, err);
                    console.log("Connected successfully to the db server");

                    self.db_find_news(db, search, self.locale, function (news) {
                        addnewsitems(news, self, body, json, headlines);
                        db.close();
                    });
                });
            });
    } else {
        MongoClient.connect(settings.get("mongodb"), function (err, db) {
            assert.equal(null, err);
            console.log("Connected successfully to the db server");

            // self.db_upsert(db, ins_obj, function () {
            self.db_find_all_news(db, self.locale, function (news) {
                addnewsitems(news, self, body, json, headlines);
                db.close();
            });
            // });
        });
    }
    //TODO 
    // previous_action = "showheadlines";
}


/**
 * \brief unsubscribe self from topic
 * \note may happen on termination or crash or exception
 *       where a subscriber using the `news_app` name exists. 
 */
myffapp.prototype.unsub_resub = function (topic) {
    var self = this;

    self.marvin.get_subscribers(topic, function (json) {
        var exists = false;
        var subs = [];
        try {
            subs = JSON.parse(json);
        } catch (e) {
            console.log('unsub_resub/parse error: ' + e);
            console.log(json);
        }
        for (var i = 0; i < subs.length; i++) {
            if (subs[i] === self.subscriber) {
                exists = true;
            }
        }
        if (exists) {
            console.log('subscriber ' + self.subscriber + ' to topic ' + topic + ' exists, removing...');
            self.marvin.unsubscribe(topic, self.subscriber, function () {
                console.log('subscriber ' + self.subscriber + ' to topic ' + topic + ' removed, re-subscribing');
                self.marvin.subscribe(topic, self.subscriber, function (message) {
                    self.msg_proc(message, topic);
                });
            });
        } else {
            console.log('subscriber ' + self.subscriber + ' to topic ' + topic + ' does not exist, subscribing');
            self.marvin.subscribe(topic, self.subscriber, function (message) {
                self.msg_proc(message, topic);
            });
        }
    });
}

/**
 * \brief search for a topic until it's created and then subscribe to it.
 * \param topic the topic to be searched.
 * \param json array with the topics, in which we are searching.
 */
myffapp.prototype.search_n_sub = function (topic, json) {
    var self = this;
    var topics = [];
    var exists = false;
    try {
        topics = JSON.parse(json);
    } catch (e) {
        console.log('init/parse error: ' + e);
        console.log(json);
    }
    for (var i = 0; i < topics.length; i++) {
        if (topics[i] === topic) {
            exists = true;
        }
    }
    // topic exists - (re)subscribe and process messages
    if (exists) {
        console.log('topic: ' + topic + ' exists, will try to subscribe');
        self.unsub_resub(topic);
    }
    // get the topics again until topic is found
    else {
        console.log('topic ' + topic + ' not found. Will try again in 0.1 seconds...');
        setTimeout(function () {
            self.marvin.get_topics(function (json) {
                self.search_n_sub(topic, json);
            });
        }, 100);
    }
}


///
/// \brief save to mongoDB the retrieved news from feedly
/// \param db is the mongoDB to which we connected
/// \param obj is an object with properties the collections with their documents
///        that we wish to insert in the dv an array of JSON objects
///
myffapp.prototype.db_insert = function (db, obj, functor) {
    for (var coll in obj) {
        // Get the documents collection
        var collection = db.collection(coll);
        // Insert some documents
        collection.insertMany(obj[coll], function (err, result) {
            assert.equal(err, null);
            assert.equal(obj[coll].length, result.result.n);
            assert.equal(obj[coll].length, result.ops.length);
            console.log("Inserted " + obj[coll].length + " documents into the collection " + coll);
            functor(result);
        });
    }
}


myffapp.prototype.db_upsert = function (db, obj, functor) {
    for (var coll in obj) {
        // Get the documents collection
        var collection = db.collection(coll);
        // Insert or update some documents
        for (var i = 0; i < obj[coll].length; i++) {
            // var ttitle = obj[coll][i].title.replace(/(?:https?|ftp):\/\/[\n\S]+/g, '');
            var h = this.hashtag;
            if (obj[coll][i].title.indexOf(h) != -1) {
                obj[coll][i].title = obj[coll][i].title.replace(/(?:https?|ftp):\/\/[\n\S]+/g, '');
                obj[coll][i].title = obj[coll][i].title.replace(new RegExp(h, 'g'), '');

                if (i === obj[coll].length - 1) {
                    collection.updateOne({
                        // title: obj[coll][i].title
                        title: obj[coll][i].title
                    }, obj[coll][i], {
                        upsert: true
                    }, function (err, result) {
                        assert.equal(err, null);
                        functor();
                    });
                } else {
                    collection.updateOne({
                        // title: obj[coll][i].title
                        title: obj[coll][i].title
                    }, obj[coll][i], {
                        upsert: true
                    }, function (err, result) {
                        assert.equal(err, null);
                    });
                }

            } 
            // else {
            //     if (i === obj[coll].length - 1) {
            //         functor();
            //     }
            // }
        }
    }
}


///
/// \brief query mongoDB for news concerning \param keyword and \param locale
/// \param functor will receive the news, an array of JSON objects
///
myffapp.prototype.db_find_news = function (db, handle, locale, functor) {
    // Get the documents collection
    var collection = db.collection('news');
    var regex = new RegExp(".*" + handle + ".*");
    collection.find({
        //"lang": locale,
        "author": regex
    }).sort({
        published: 1
    }).limit(20).toArray(function (err, docs) {
        assert.equal(err, null);
        console.log("Found " + docs.length + " news records");
        functor(docs);
    });
}
myffapp.prototype.db_find_all_news = function (db, locale, functor) {
    // Get the documents collection
    var collection = db.collection('news');
    // var regex = new RegExp(".*" + handle + ".*");
    collection.find({
        //"lang": locale,
        // "author": regex
    }).sort({
        published: 1
    }).limit(20).toArray(function (err, docs) {
        assert.equal(err, null);
        console.log("Found " + docs.length + " news records");
        functor(docs);
    });
}


///
/// \brief query mongoDB for news concerning \param keyword and \param locale
/// \param functor will receive the news, an array of JSON objects
///
myffapp.prototype.db_find_topics = function (db, user, functor) {
    // Get the documents collection
    var collection = db.collection('users');
    collection.findOne({
        "user": user
    }, {
        profiles: true,
        hashtag: true,
        _id: false
    }, function (err, docs) {
        assert.equal(err, null);
        console.log("Found " + docs.profiles.length + " topic records");
        functor(docs);
    });
}


/**
 * \brief subscribe to taskmanager topic
 */
myffapp.prototype.run = function () {
    var self = this;

    self.marvin.get_topics(function (json) {
        self.search_n_sub("taskmanager", json);
    });
    self.get_news();
    setInterval(function () {
        self.get_news();
        console.log("test");
    }, settings.get("update_frequency") * 60000);

}

myffapp.prototype.get_news = function () {
    var self = this;

    var crawler = new queryfeedclient();
    var profiles = settings.get("profiles");

    for (p in profiles) {
        crawler.search(profiles[p].handle, self.hashtag /*settings.get("hashtag")*/ , self.locale,
            function (news) {
                // console.log("news downloaded for" + news[0].author);
                MongoClient.connect(settings.get("mongodb"), function (err, db) {
                    assert.equal(null, err);
                    console.log("Connected successfully to the db server");
                    var ins_obj = {};
                    ins_obj.news = news;

                    self.db_upsert(db, ins_obj, function () {
                        console.log("news downloaded for" + ins_obj.news[0].author);
                    });
                });
            },
            function (error) {
                console.log(error);
            });
    }
};

/// exports
module.exports = myffapp;