const maxTimeDifference = 2;

var resourceName = 'pmms';
var isRDR = false;
var audioVisualizations = {};
var currentServerEndpoint = '127.0.0.1:30120';

function sendMessage(name, params) {
    return fetch('https://' + resourceName + '/' + name, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(params || {})
    });
}

function setResourceNameFromUrl() {
    try {
        var url = new URL(window.location);
        var params = new URLSearchParams(url.search);
        resourceName = params.get('resourceName') || resourceName;
    } catch (_) {}
}

function applyPhonographFilter(player) {
    var context = new (window.AudioContext || window.webkitAudioContext)();
    var source;

    if (player.youTubeApi) {
        var html5Player = player.youTubeApi.getIframe().contentWindow.document.querySelector('.html5-main-video');
        source = context.createMediaElementSource(html5Player);
    } else if (player.hlsPlayer) {
        source = context.createMediaElementSource(player.hlsPlayer.media);
    } else if (player.originalNode) {
        source = context.createMediaElementSource(player.originalNode);
    } else {
        source = context.createMediaElementSource(player);
    }

    if (!source) {
        return;
    }

    var splitter = context.createChannelSplitter(2);
    var merger = context.createChannelMerger(2);

    var gainNode = context.createGain();
    gainNode.gain.value = 0.5;

    var lowpass = context.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 3000;

    var highpass = context.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 300;

    source.connect(splitter);
    splitter.connect(merger, 0, 0);
    splitter.connect(merger, 1, 0);
    splitter.connect(merger, 0, 1);
    splitter.connect(merger, 1, 1);
    merger.connect(gainNode);
    gainNode.connect(lowpass);
    lowpass.connect(highpass);
    highpass.connect(context.destination);
}

function applyRadioFilter(player) {
    var context = new (window.AudioContext || window.webkitAudioContext)();
    var source;

    if (player.youTubeApi) {
        var html5Player = player.youTubeApi.getIframe().contentWindow.document.querySelector('.html5-main-video');
        source = context.createMediaElementSource(html5Player);
    } else if (player.hlsPlayer) {
        source = context.createMediaElementSource(player.hlsPlayer.media);
    } else if (player.originalNode) {
        source = context.createMediaElementSource(player.originalNode);
    } else {
        source = context.createMediaElementSource(player);
    }

    if (!source) {
        return;
    }

    var splitter = context.createChannelSplitter(2);
    var merger = context.createChannelMerger(2);

    var gainNode = context.createGain();
    gainNode.gain.value = 0.5;

    var lowpass = context.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 5000;

    var highpass = context.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 200;

    source.connect(splitter);
    splitter.connect(merger, 0, 0);
    splitter.connect(merger, 1, 0);
    splitter.connect(merger, 0, 1);
    splitter.connect(merger, 1, 1);
    merger.connect(gainNode);
    gainNode.connect(lowpass);
    lowpass.connect(highpass);
    highpass.connect(context.destination);
}

function createAudioVisualization(player, visualization) {
    var waveCanvas = document.createElement('canvas');
    waveCanvas.id = player.id + '_visualization';
    waveCanvas.style.position = 'absolute';
    waveCanvas.style.top = '0';
    waveCanvas.style.left = '0';
    waveCanvas.style.width = '100%';
    waveCanvas.style.height = '100%';

    player.appendChild(waveCanvas);

    var html5Player;

    if (player.youTubeApi) {
        html5Player = player.youTubeApi.getIframe().contentWindow.document.querySelector('.html5-main-video');
    } else if (player.hlsPlayer) {
        html5Player = player.hlsPlayer.media;
    } else if (player.originalNode) {
        html5Player = player.originalNode;
    } else {
        html5Player = player;
    }

    if (!html5Player.id) {
        html5Player.id = player.id + '_html5Player';
    }

    html5Player.style.visibility = 'hidden';

    var doc = player.youTubeApi ? player.youTubeApi.getIframe().contentWindow.document : document;
    if (player.youTubeApi) {
        player.youTubeApi.getIframe().style.visibility = 'hidden';
    }

    var wave = new Wave();
    var options;

    if (visualization) {
        options = audioVisualizations[visualization] || {};
        if (options.type === undefined) {
            options.type = visualization;
        }
    } else {
        options = { type: 'cubes' };
    }

    options.skipUserEventsWatcher = true;
    options.elementDoc = doc;

    wave.fromElement(html5Player.id, waveCanvas.id, options);
}

function showLoadingIcon() {
    var loading = document.getElementById('loading');
    if (loading) {
        loading.style.display = 'block';
    }
}

function hideLoadingIcon() {
    var loading = document.getElementById('loading');
    if (loading) {
        loading.style.display = 'none';
    }
}

function resolveUrl(url) {
    if (typeof url !== 'string') {
        return '';
    }

    if (url.startsWith('http://') || url.startsWith('https://')) {
        return url;
    }

    return 'http://' + currentServerEndpoint + '/pmms/media/' + url;
}

function parseTimecode(timecode) {
    if (typeof timecode !== 'string') {
        var value = Number(timecode);
        return Number.isFinite(value) ? value : 0;
    }

    if (timecode.includes(':')) {
        var parts = timecode.split(':').map(function (part) {
            return parseInt(part, 10) || 0;
        });

        while (parts.length < 3) {
            parts.unshift(0);
        }

        return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
    }

    var direct = parseInt(timecode, 10);
    return Number.isFinite(direct) ? direct : 0;
}

function describeYouTubeError(code) {
    var numeric = Number(code);
    if (numeric === 2) return 'YouTube error 2: Invalid video request.';
    if (numeric === 5) return 'YouTube error 5: HTML5 playback error.';
    if (numeric === 100) return 'YouTube error 100: Video not found or private.';
    if (numeric === 101 || numeric === 150) return 'YouTube error ' + numeric + ': Video owner blocked embedded playback.';
    if (Number.isFinite(numeric)) return 'YouTube error ' + numeric + '.';
    return 'YouTube playback error.';
}

function getPlaybackErrorMessage(media, fallbackText) {
    if (media && media.error) {
        if (media.error.message) {
            return media.error.message;
        }
        if (media.error.code !== undefined && media.error.code !== null) {
            return 'Media error code ' + media.error.code;
        }
    }
    return fallbackText;
}

function removePlayer(player) {
    if (!player) {
        return;
    }

    var noise = document.getElementById(player.id + '_noise');
    if (noise) {
        noise.remove();
    }

    player.remove();
}

function initPlayer(id, handle, options) {
    var player = document.createElement('video');
    player.id = id;
    player.src = resolveUrl(options.url);
    player.dataset.handle = String(handle);

    player.pmms = {
        initialized: false,
        attenuationFactor: options.attenuation && Number.isFinite(Number(options.attenuation.diffRoom))
            ? Number(options.attenuation.diffRoom)
            : 0,
        volumeFactor: Number.isFinite(Number(options.diffRoomVolume)) ? Number(options.diffRoomVolume) : 1.0,
        currentUrl: options.url
    };

    document.body.appendChild(player);

    if (options.attenuation == null) {
        options.attenuation = { sameRoom: 0, diffRoom: 0 };
    }

    new MediaElement(id, {
        youtube: {
            nocookie: true
        },
        error: function (media) {
            hideLoadingIcon();

            sendMessage('initError', {
                handle: handle,
                url: options.url,
                message: getPlaybackErrorMessage(media, 'Unknown init error')
            });

            media.remove();
        },
        success: function (media) {
            media.className = 'player';

            media.pmms = media.pmms || {};
            media.pmms.initialized = false;
            media.pmms.attenuationFactor = options.attenuation.diffRoom;
            media.pmms.volumeFactor = options.diffRoomVolume || 1.0;
            media.pmms.currentUrl = options.url;

            media.volume = 0;
            media.style.display = options.video !== false ? 'block' : 'none';

            if (media.youTubeApi && typeof media.youTubeApi.addEventListener === 'function') {
                media.youTubeApi.addEventListener('onError', function (event) {
                    hideLoadingIcon();
                    sendMessage('playError', {
                        handle: handle,
                        url: options.url,
                        message: describeYouTubeError(event && event.data)
                    });
                });
            }

            media.addEventListener('error', function () {
                hideLoadingIcon();

                sendMessage('playError', {
                    handle: handle,
                    url: options.url,
                    message: getPlaybackErrorMessage(media, 'Unknown playback error')
                });

                if (!media.pmms.initialized) {
                    media.remove();
                }
            });

            media.addEventListener('canplay', function () {
                if (media.pmms.initialized) {
                    return;
                }

                hideLoadingIcon();

                var duration = Number(media.duration);
                if (!Number.isFinite(duration) || duration <= 0 || media.hlsPlayer) {
                    options.offset = 0;
                    options.duration = false;
                    options.loop = false;
                } else {
                    options.duration = duration;
                }

                if (media.youTubeApi) {
                    var data = media.youTubeApi.getVideoData ? media.youTubeApi.getVideoData() : null;
                    if (data && data.title) {
                        options.title = data.title;
                    }
                    media.videoTracks = { length: 1 };
                } else if (media.hlsPlayer) {
                    media.videoTracks = media.hlsPlayer.videoTracks || { length: 0 };
                } else if (media.originalNode && media.originalNode.videoTracks) {
                    media.videoTracks = media.originalNode.videoTracks;
                } else {
                    media.videoTracks = { length: 0 };
                }

                sendMessage('init', {
                    handle: handle,
                    options: options
                });

                media.pmms.initialized = true;
                media.play();
            });

            media.addEventListener('playing', function () {
                if (options.filter && !media.pmms.filterAdded) {
                    if (isRDR) {
                        applyPhonographFilter(media);
                    } else {
                        applyRadioFilter(media);
                    }
                    media.pmms.filterAdded = true;
                }

                if (options.visualization && !media.pmms.visualizationAdded) {
                    createAudioVisualization(media, options.visualization);
                    media.pmms.visualizationAdded = true;
                }
            });

            media.play();
        }
    });

    return player;
}

function getPlayer(handle, options) {
    if (handle === undefined || handle === null) {
        return null;
    }

    var id = 'player_' + handle.toString();
    var player = document.getElementById(id);

    if (!player && options && options.url) {
        player = initPlayer(id, handle, options);
    }

    if (player && !player.pmms) {
        player.pmms = {
            initialized: false,
            attenuationFactor: 0,
            volumeFactor: 1.0,
            currentUrl: options && options.url ? options.url : ''
        };
    }

    return player;
}

function setAttenuationFactor(player, target) {
    if (!player.pmms) {
        return;
    }
    if (!Number.isFinite(Number(target))) {
        target = player.pmms.attenuationFactor || 0;
    }

    if (player.pmms.attenuationFactor > target) {
        player.pmms.attenuationFactor -= 0.1;
    } else {
        player.pmms.attenuationFactor += 0.1;
    }
}

function setVolumeFactor(player, target) {
    if (!player.pmms) {
        return;
    }
    if (!Number.isFinite(Number(target))) {
        target = player.pmms.volumeFactor || 1.0;
    }

    if (player.pmms.volumeFactor > target) {
        player.pmms.volumeFactor -= 0.01;
    } else {
        player.pmms.volumeFactor += 0.01;
    }
}

function setVolume(player, target) {
    if (Math.abs(player.volume - target) > 0.1) {
        if (player.volume > target) {
            player.volume -= 0.05;
        } else {
            player.volume += 0.05;
        }
    }
}

function init(data) {
    if (!data || !data.options || !data.options.url) {
        return;
    }

    showLoadingIcon();

    data.options.offset = parseTimecode(data.options.offset);
    if (!data.options.title) {
        data.options.title = data.options.url;
    }

    getPlayer(data.handle, data.options);
}

function stop(handle) {
    var player = getPlayer(handle);
    if (player) {
        removePlayer(player);
    }
}

function update(data) {
    if (!data || !data.options) {
        return;
    }

    if (!data.options.attenuation) {
        data.options.attenuation = { sameRoom: 0, diffRoom: 0 };
    }
    if (!Number.isFinite(Number(data.options.diffRoomVolume))) {
        data.options.diffRoomVolume = 1.0;
    }

    var player = getPlayer(data.handle, data.options);
    if (!player) {
        return;
    }

    if (data.options.paused || data.distance < 0 || data.distance > data.options.range) {
        if (!player.paused) {
            player.pause();
        }
    } else {
        if (data.sameRoom) {
            setAttenuationFactor(player, data.options.attenuation.sameRoom);
            setVolumeFactor(player, 1.0);
        } else {
            setAttenuationFactor(player, data.options.attenuation.diffRoom);
            setVolumeFactor(player, data.options.diffRoomVolume);
        }

        if (player.readyState > 0) {
            var volume;

            if (data.options.muted || data.volume === 0) {
                volume = 0;
            } else {
                volume = (((100 - data.distance * player.pmms.attenuationFactor) / 100) * player.pmms.volumeFactor) * (data.volume / 100);
            }

            if (volume > 0) {
                if (data.distance > 100) {
                    setVolume(player, volume);
                } else {
                    player.volume = volume;
                }
            } else {
                player.volume = 0;
            }

            if (data.options.duration && Number.isFinite(Number(player.duration)) && player.duration > 0) {
                var targetOffset = Number.isFinite(Number(data.offset)) ? Number(data.offset) : Number(data.options.offset || 0);
                var currentTime = targetOffset % player.duration;

                if (Math.abs(currentTime - player.currentTime) > maxTimeDifference) {
                    player.currentTime = currentTime;
                }
            }

            if (player.paused) {
                player.play();
            }
        }
    }

    player.style.display = data.options.video !== false ? 'block' : 'none';
}

window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || !data.type) {
        return;
    }

    switch (data.type) {
        case 'init':
            init(data);
            break;
        case 'stop':
            stop(data.handle);
            break;
        case 'update':
            update(data);
            break;
        case 'DuiBrowser:init':
            sendMessage('DuiBrowser:initDone', { handle: data.handle });
            break;
    }
});

window.addEventListener('load', function () {
    setResourceNameFromUrl();

    sendMessage('duiStartup', {})
        .then(function (resp) { return resp.json(); })
        .then(function (resp) {
            if (resp.isRDR !== undefined) {
                isRDR = resp.isRDR;
            }
            if (resp.audioVisualizations !== undefined) {
                audioVisualizations = resp.audioVisualizations;
            }
            if (resp.currentServerEndpoint !== undefined) {
                currentServerEndpoint = resp.currentServerEndpoint;
            }
        })
        .catch(function () {});
});
