const request = require('request'),
    extend = require('extend'),
    Promise = require('bluebird'),
    CachemanFile = require('cacheman-file'),
    listURL = 'https://www.instagram.com/explore/tags/',
    postURL = 'https://www.instagram.com/p/',
    locURL  = 'https://www.instagram.com/explore/locations/',
    dataExp = /window\._sharedData\s?=\s?({.+);<\/script>/;


var scrape = function(html) {
    try {
        var dataString = html.match(dataExp)[1];
        var json = JSON.parse(dataString);
    }
    catch(e) {
        if (process.env.NODE_ENV != 'production') {
            console.error('The HTML returned from instagram was not suitable for scraping');
        }
        return null
    }

    return json;
};


var Instagram = function (options) {
    const self = this;

    this._config = {};

    extend(this._config, {
        cache : {
            prefix : 'ig-',
            isIgnore : false,
            ttl : 60 * 30, // 30 min
            tmpDir : null
        }
    }, options);

    if(!this._config.cache.isIgnore) {
        this._cache = new CachemanFile({
            tmpDir: this._config.tmpDir
        });
    }
};

Instagram.prototype._request = function(id, uri, callback){
    const self = this;
    const req = function(callback){
        request(uri, callback);
    };
    const key = this._config.cache.prefix + id;

    if(!this._cache || this._config.cache.isIgnore){
        req(callback);
        return;
    }

    this._cache.get(key, function(err, value){
        if (err) throw err;

        if(value === null){
            req(function(reqErr, response, body){
                if (!reqErr && response.statusCode === 200) {
                    callback(reqErr, response, body);

                    self._cache.set(key, response, self._config.cache.ttl, function (err, value) {
                        if (err) throw err;
                    });

                } else {
                    throw err;
                }
            });

        } else {
            callback(null, value, value.body);
        }
    });
};

Instagram.prototype.deepScrapeTagPage = function(tag){
    const self = this;

    return new Promise(function(resolve, reject){
        self.scrapeTagPage(tag).then(function(tagPage){
            return Promise.map(tagPage.media, function(media, i, len) {
                return self.scrapePostPage(media.code).then(function(postPage){
                    tagPage.media[i] = postPage;
                    if (postPage.location != null && postPage.location.has_public_page) {
                        return self.scrapeLocationPage(postPage.location.id).then(function(locationPage){
                            tagPage.media[i].location = locationPage;
                        })
                            .catch(function(err) {
                                console.log("An error occurred calling scrapeLocationPage inside deepScrapeTagPage" + ":" + err);
                            });
                    }
                })
                    .catch(function(err) {
                        console.log("An error occurred calling scrapePostPage inside deepScrapeTagPage" + ":" + err);
                    });
            })
                .then(function(){ resolve(tagPage); })
                .catch(function(err) {
                    console.log("An error occurred resolving tagPage inside deepScrapeTagPage" + ":" + err);
                });
        })
            .catch(function(err) {
                console.log("An error occurred calling scrapeTagPage inside deepScrapeTagPage" + ":" + err);
            });
    });

};


Instagram.prototype.scrapeTagPage = function(tag){
    const self = this;

    return new Promise(function(resolve, reject){
        if (!tag) return reject(new Error('Argument "tag" must be specified'));

        self._request('tag-'+tag, listURL + tag, function(err, response, body){
            if (err) return reject(err);

            var data = scrape(body)

            if(data &&
                data.entry_data &&
                data.entry_data.TagPage
            ) {
                var media = (function(TagPage) {
                    if (TagPage.graphql &&
                        TagPage.graphql.hashtag &&
                        TagPage.graphql.hashtag.edge_hashtag_to_media
                    ) {
                        var model = TagPage.graphql.hashtag.edge_hashtag_to_media

                        model.edges = model.edges.map(function(item){
                            item = item.node
                            item.code = item.shortcode
                            item.caption = item.edge_media_to_caption.edges[0].node.text
                            item.comment = item.edge_media_to_comment
                            item.liked_by = item.edge_liked_by
                            return item
                        })

                        return {
                            count: model.count,
                            nodes: model.edges,
                            edges: model.edges
                        };
                    }
                    else {
                        TagPage.tag.media.edges = TagPage.tag.media.edges || TagPage.tag.media.nodes
                        return TagPage.tag.media
                    }
                })(data.entry_data.TagPage[0]);

                resolve({
                    total: media.count,
                    count: media.nodes.length,
                    media: media.edges
                });
            }
            else {
                reject(new Error('Error scraping tag page "' + tag + '"'));
            }
        })
    });
};

Instagram.prototype.scrapePostPage = function(code){
    const self = this;

    return new Promise(function(resolve, reject){
        if (!code) return reject(new Error('Argument "code" must be specified'));

        self._request('post-'+code, postURL + code, function(err, response, body){
            var data = scrape(body);
            if (data) {
                resolve(data.entry_data.PostPage[0].graphql.shortcode_media); 
            }
            else {
                reject(new Error('Error scraping post page "' + code + '"'));
            }
        });
    });
};

Instagram.prototype.scrapeLocationPage = function(id){
    const self = this;

    return new Promise(function(resolve, reject){
        if (!id) return reject(new Error('Argument "id" must be specified'));

        self._request('loc-'+id, locURL + id, function(err, response, body){
            var data = scrape(body);

            if (data) {
                resolve(data.entry_data.LocationsPage[0].location);
            }
            else {
                reject(new Error('Error scraping location page "' + id + '"'));
            }
        });
    });
};


module.exports = Instagram;

