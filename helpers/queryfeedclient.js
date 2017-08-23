#!/usr/bin/node

var http = require('http');
var feedread = require("feed-read");
var striptags = require('striptags');
var Entities = require('html-entities').XmlEntities;
var entities = new Entities();

/**
 * \brief feedly feedlyclient/client
 * \version 0.1.0
 * \date April 2016
 */
function queryfeedclient() {
    this.ip = 'queryfeed.net';
    this.port = 80;
}

/// \brief parse an RSS/Atom feed
/// \param uri defines the feed url
/// \param functor receives the news
queryfeedclient.prototype.parse_feed = function (author, uri, locale, functor) {
    /// \var feedread is from npm feed-read parser
    feedread(uri, function (err, articles) {
        var news = [];
        for (var i in articles) {
            var text = articles[i].content;
            text = text.replace(/\n$/g, '');
            //            text     = text.replace(/<(?:.|\n)*?>/gm, '');  
            //            text     = text.replace(/&nbsp;/gi,''); 
            //            text     = striptags(text);
            text = entities.decode(text);
            if (articles[i].author == "") {
                articles[i].author = author;
            };
            news.push({
                author: articles[i].author,
                title: entities.decode(striptags(articles[i].title)),
                published: articles[i].published, //.toISOString(),
                content: text,
                lang: locale
            });
        }
        functor(news);
    });
}

/// \brief create new topic
/// \param name the name of the topic
queryfeedclient.prototype.search = function (query, hashtag, locale, on_success, on_failure) {

    var self = this;

    uri = "http://queryfeed.net/twitter?q=from%3A"+query+"+%23"+hashtag+"&title-type=tweet-text-full&geocode=";
    // uri = "http://queryfeed.net/twitter?q=from%3A" + query + "&title-type=tweet-text-full&geocode=";
    self.parse_feed(query, uri, locale, function (reply) {
        // call the on_success functor each time a news feed is received
        var newreply = [];
        for (var o in reply) {
            if (reply[o].title.indexOf(hashtag) >= 0) {
                newreply.push(reply[o]);
            }
        }
        on_success(newreply);
        // on_success(replay);
    });

}

/// exports
module.exports = queryfeedclient;