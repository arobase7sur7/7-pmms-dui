const maxTimeDifference = 2;

var resourceName = 'pmms';
const RANGE_ENTER_BUFFER = 1.0;
const RANGE_EXIT_BUFFER = 2.4;
const RANGE_MISS_GRACE_MS = 1700;
const DEFAULT_TRANSITION_SECONDS = 2.0;
const MAX_TRANSITION_SECONDS = 8.0;

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

function clamp01(value) {
    if (!Number.isFinite(Number(value))) return 0;
    return Math.max(0, Math.min(1, Number(value)));
}

function clampTransitionSeconds(value) {
    if (!Number.isFinite(Number(value))) return DEFAULT_TRANSITION_SECONDS;
    return Math.max(0, Math.min(MAX_TRANSITION_SECONDS, Number(value)));
}

function getNowMs() {
    if (window.performance && typeof window.performance.now === 'function') {
        return window.performance.now();
    }
    return Date.now();
}

function ensurePlayerState(player) {
    if (!player.pmms) {
        player.pmms = {};
    }

    if (!Number.isFinite(Number(player.pmms.attenuationFactor))) {
        player.pmms.attenuationFactor = 0;
    }
    if (!Number.isFinite(Number(player.pmms.volumeFactor))) {
        player.pmms.volumeFactor = 1.0;
    }
    if (!Number.isFinite(Number(player.pmms.transitionSeconds))) {
        player.pmms.transitionSeconds = DEFAULT_TRANSITION_SECONDS;
    }
    if (player.pmms.inRange === undefined) {
        player.pmms.inRange = true;
    }
    if (!Number.isFinite(Number(player.pmms.lastDistance))) {
        player.pmms.lastDistance = -1;
    }
    if (!Number.isFinite(Number(player.pmms.lastDistanceAt))) {
        player.pmms.lastDistanceAt = 0;
    }
}

function startFadeOutAndRemove(player, transitionSeconds) {
    if (!player) return;

    var durationMs = Math.max(0, clampTransitionSeconds(transitionSeconds) * 1000);
    if (durationMs <= 0) {
        removePlayer(player);
        return;
    }

    var startedAt = getNowMs();
    var startVolume = clamp01(player.volume);
    var raf = window.requestAnimationFrame || function(cb) { return setTimeout(function() { cb(getNowMs()); }, 16); };

    var step = function(now) {
        if (!player || !player.parentNode) {
            return;
        }

        var elapsed = Math.max(0, now - startedAt);
        var t = Math.min(1, elapsed / durationMs);
        var nextVolume = startVolume * (1 - t);
        player.volume = clamp01(nextVolume);

        if (t >= 1) {
            removePlayer(player);
            return;
        }

        raf(step);
    };

    raf(step);
}

function getFadeInGain(player, nowMs) {
    if (!player || !player.pmms || !player.pmms.fadeInEndsAt) {
        return 1;
    }

    var startedAt = Number(player.pmms.fadeInStartedAt) || 0;
    var endsAt = Number(player.pmms.fadeInEndsAt) || 0;
    if (endsAt <= startedAt || nowMs >= endsAt) {
        player.pmms.fadeInStartedAt = 0;
        player.pmms.fadeInEndsAt = 0;
        return 1;
    }

    return clamp01((nowMs - startedAt) / (endsAt - startedAt));
}

function removePlayer(player) {
    if (!player) {
        return;
    }

    if (player.pmms) {
        player.pmms.removed = true;
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
        currentUrl: options.url,
        transitionSeconds: clampTransitionSeconds(options.transitionSeconds),
        fadeInStartedAt: 0,
        fadeInEndsAt: 0,
        inRange: true,
        lastDistance: -1,
        lastDistanceAt: 0
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
            media.pmms.transitionSeconds = clampTransitionSeconds(options.transitionSeconds);
            media.pmms.inRange = true;
            media.pmms.lastDistance = -1;
            media.pmms.lastDistanceAt = 0;
            media.pmms.fadeInStartedAt = 0;
            media.pmms.fadeInEndsAt = 0;

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

                var resolvedDuration = Number(media.duration);
                if ((!Number.isFinite(resolvedDuration) || resolvedDuration <= 0) && media.seekable && media.seekable.length > 0) {
                    try {
                        var seekableEnd = Number(media.seekable.end(media.seekable.length - 1));
                        var seekableStart = Number(media.seekable.start(0)) || 0;
                        if (Number.isFinite(seekableEnd) && seekableEnd > seekableStart) {
                            resolvedDuration = seekableEnd - seekableStart;
                        }
                    } catch (_) {}
                }

                if (Number.isFinite(resolvedDuration) && resolvedDuration > 0) {
                    options.duration = resolvedDuration;
                } else {
                    options.duration = false;
                    options.loop = false;
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
                if (media.pmms.transitionSeconds > 0) {
                    var fadeNow = getNowMs();
                    media.pmms.fadeInStartedAt = fadeNow;
                    media.pmms.fadeInEndsAt = fadeNow + (media.pmms.transitionSeconds * 1000);
                }
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
            currentUrl: options && options.url ? options.url : '',
            transitionSeconds: clampTransitionSeconds(options && options.transitionSeconds),
            fadeInStartedAt: 0,
            fadeInEndsAt: 0,
            inRange: true,
            lastDistance: -1,
            lastDistanceAt: 0
        };
    }

    if (player) {
        ensurePlayerState(player);
    }

    return player;
}

function setAttenuationFactor(player, target) {
    ensurePlayerState(player);
    var numericTarget = Number(target);
    if (!Number.isFinite(numericTarget)) {
        numericTarget = Number(player.pmms.attenuationFactor) || 0;
    }
    numericTarget = Math.max(0, Math.min(10, numericTarget));

    var current = Number(player.pmms.attenuationFactor) || 0;
    player.pmms.attenuationFactor = current + ((numericTarget - current) * 0.25);
}

function setVolumeFactor(player, target) {
    ensurePlayerState(player);
    var numericTarget = Number(target);
    if (!Number.isFinite(numericTarget)) {
        numericTarget = Number(player.pmms.volumeFactor) || 1.0;
    }
    numericTarget = clamp01(numericTarget);

    var current = Number(player.pmms.volumeFactor) || 1.0;
    player.pmms.volumeFactor = current + ((numericTarget - current) * 0.2);
}

function setVolume(player, target) {
    var normalizedTarget = clamp01(target);
    var current = clamp01(player.volume);
    var delta = normalizedTarget - current;

    if (Math.abs(delta) <= 0.003) {
        player.volume = normalizedTarget;
        return;
    }

    var step = Math.min(0.08, Math.max(0.01, Math.abs(delta) * 0.35));
    player.volume = current + (delta > 0 ? step : -step);

    if ((delta > 0 && player.volume > normalizedTarget) || (delta < 0 && player.volume < normalizedTarget)) {
        player.volume = normalizedTarget;
    }
}

function init(data) {
    if (!data || !data.options || !data.options.url) {
        return;
    }

    showLoadingIcon();

    data.options.offset = parseTimecode(data.options.offset);
    data.options.transitionSeconds = clampTransitionSeconds(data.options.transitionSeconds);
    if (!data.options.title) {
        data.options.title = data.options.url;
    }

    getPlayer(data.handle, data.options);
}

function stop(handle) {
    var player = getPlayer(handle);
    if (player) {
        ensurePlayerState(player);
        var transitionSeconds = clampTransitionSeconds(player.pmms.transitionSeconds);
        if (transitionSeconds > 0) {
            player.id = player.id + '_fade_' + Date.now();
            startFadeOutAndRemove(player, transitionSeconds);
            return;
        }
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
    ensurePlayerState(player);
    player.pmms.transitionSeconds = clampTransitionSeconds(data.options.transitionSeconds);

    var nowMs = getNowMs();
    var distance = Number(data.distance);
    var hasDistance = Number.isFinite(distance) && distance >= 0;
    if (hasDistance) {
        player.pmms.lastDistance = distance;
        player.pmms.lastDistanceAt = nowMs;
    } else if (Number.isFinite(Number(player.pmms.lastDistance))
        && Number(player.pmms.lastDistance) >= 0
        && (nowMs - Number(player.pmms.lastDistanceAt || 0)) <= RANGE_MISS_GRACE_MS) {
        distance = Number(player.pmms.lastDistance);
        hasDistance = true;
    }

    var range = Number(data.options.range);
    if (!Number.isFinite(range) || range < 0) {
        range = 0;
    }

    if (hasDistance) {
        if (player.pmms.inRange) {
            if (distance > (range + RANGE_EXIT_BUFFER)) {
                player.pmms.inRange = false;
            }
        } else if (distance <= (range + RANGE_ENTER_BUFFER)) {
            player.pmms.inRange = true;
        }
    } else if ((nowMs - Number(player.pmms.lastDistanceAt || 0)) > RANGE_MISS_GRACE_MS) {
        player.pmms.inRange = false;
    }

    if (data.sameRoom) {
        setAttenuationFactor(player, data.options.attenuation.sameRoom);
        setVolumeFactor(player, 1.0);
    } else {
        setAttenuationFactor(player, data.options.attenuation.diffRoom);
        setVolumeFactor(player, data.options.diffRoomVolume);
    }

    if (player.readyState > 0) {
        var targetVolume = 0;
        var pausedByState = data.options.paused === true;
        var inRange = player.pmms.inRange === true;
        var serverVolume = Number(data.volume);
        if (!Number.isFinite(serverVolume)) {
            serverVolume = 100;
        }

        if (!pausedByState && inRange && !data.options.muted && serverVolume > 0) {
            var attenuationBase = ((100 - (Math.max(0, distance) * player.pmms.attenuationFactor)) / 100) * player.pmms.volumeFactor;
            targetVolume = clamp01(attenuationBase * (serverVolume / 100));
            targetVolume = clamp01(targetVolume * getFadeInGain(player, nowMs));
        }

        setVolume(player, targetVolume);

        if (pausedByState) {
            if (!player.paused) {
                player.pause();
            }
        } else if (inRange) {
            var syncDuration = Number(data.options.duration);
            if (Number.isFinite(syncDuration) && syncDuration > 0) {
                var targetOffset = Number.isFinite(Number(data.offset)) ? Number(data.offset) : Number(data.options.offset || 0);
                var currentTime = targetOffset % syncDuration;

                if (Math.abs(currentTime - player.currentTime) > maxTimeDifference) {
                    player.currentTime = currentTime;
                }
            }

            if (player.paused) {
                player.play();
            }
        } else if (!player.paused && player.volume <= 0.01) {
            player.pause();
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
