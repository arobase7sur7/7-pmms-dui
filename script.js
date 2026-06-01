const maxTimeDifference = 2;

var resourceName = 'pmms';
const RANGE_ENTER_BUFFER = 1.0;
const RANGE_EXIT_BUFFER = 2.4;
const RANGE_MISS_GRACE_MS = 1700;
var defaultTransitionSeconds = 5.0;
var maxTransitionSeconds = 15.0;
var rangeCurveExponent = 1.6;
var defaultStartupTimeoutMs = 15000;
var debugConfig = { enabled: false };
var hlsCanvasConfig = {
    enabled: true,
    maxWidth: 1920,
    maxHeight: 1080,
    maxFps: 30
};
var youtubeExternalPlayerConfig = {
    externalPlayerUrl: '',
    preferExternalPlayer: true,
    allowFrontendFallback: false,
    frontendFallbackTimeoutMs: 6000,
    frontendInstances: []
};
var hostedPlayerConfig = {
    hostedPlayerUrl: '',
    useHostedPlayer: true
};
var audioLanguagePriority = ['original', 'en', 'en-US', 'und'];
var startupConfigLoaded = false;
var startupConfigCallbacks = [];
var youtubeIframeApiReady = false;
var youtubeIframeApiLoading = false;
var youtubeIframeApiCallbacks = [];
var twitchEmbedApiReady = false;
var twitchEmbedApiLoading = false;
var twitchEmbedApiCallbacks = [];

var audioVisualizations = {};
var currentServerEndpoint = '127.0.0.1:30120';

function debugEnabled(category) {
    var cfg = debugConfig || {};
    if (cfg === true) {
        return true;
    }
    if (!cfg.enabled) {
        return false;
    }
    if (cfg.all) {
        return true;
    }
    return cfg[category] === true || (category === 'dui_browser' && cfg.dui === true);
}

function debugLog(category, message, data) {
    if (!debugEnabled(category)) {
        return;
    }
    try {
        var suffix = '';
        if (data !== undefined) {
            try {
                suffix = ' | ' + JSON.stringify(data);
            } catch (_) {
                suffix = ' | ' + String(data);
            }
        }
        console.debug('[7-pmms][debug:' + category + '] ' + message + suffix);
    } catch (_) {}
}

function whenStartupConfigLoaded(callback) {
    if (startupConfigLoaded) {
        callback();
        return;
    }

    startupConfigCallbacks.push(callback);
}

function finishStartupConfigLoad() {
    if (startupConfigLoaded) {
        return;
    }

    startupConfigLoaded = true;
    var callbacks = startupConfigCallbacks.slice();
    startupConfigCallbacks = [];
    callbacks.forEach(function(callback) {
        try {
            callback();
        } catch (_) {}
    });
}

function redactUrlForDebug(url) {
    if (!url || typeof url !== 'string') {
        return url || null;
    }
    try {
        var parsed = new URL(url, window.location.href);
        return parsed.origin + parsed.pathname + (parsed.search ? '?...' : '') + (parsed.hash ? '#...' : '');
    } catch (_) {
        return url.replace(/[?#].*$/, function(match) {
            return match.charAt(0) + '...';
        });
    }
}

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

function isUsableExternalPlayerUrl(url) {
    if (typeof url !== 'string' || !url.trim()) {
        return false;
    }
    try {
        var parsed = new URL(url.trim(), window.location.href);
        if (parsed.protocol === 'https:') {
            return true;
        }
        return parsed.protocol === 'http:' && /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(parsed.hostname);
    } catch (_) {
        return false;
    }
}

function normalizeYoutubeExternalPlayerConfig(input) {
    input = input || {};
    var config = {
        externalPlayerUrl: '',
        preferExternalPlayer: input.preferExternalPlayer !== false,
        allowFrontendFallback: input.allowFrontendFallback === true,
        frontendFallbackTimeoutMs: Math.max(2500, Math.min(12000, Number(input.frontendFallbackTimeoutMs) || 6000)),
        frontendInstances: []
    };

    if (isUsableExternalPlayerUrl(input.externalPlayerUrl)) {
        config.externalPlayerUrl = String(input.externalPlayerUrl).trim();
    }

    if (Array.isArray(input.frontendInstances)) {
        input.frontendInstances.forEach(function(instance) {
            var instanceUrl = typeof instance === 'object' && instance
                ? (instance.url || instance.origin || instance.baseUrl || '')
                : instance;
            if (!isUsableExternalPlayerUrl(instanceUrl)) {
                return;
            }
            try {
                var parsed = new URL(String(instanceUrl).trim());
                parsed.hash = '';
                parsed.search = '';
                var type = typeof instance === 'object' && instance && instance.type
                    ? String(instance.type).toLowerCase()
                    : 'auto';
                var templates = [];
                if (typeof instance === 'object' && instance) {
                    if (typeof instance.template === 'string' && instance.template) {
                        templates.push(instance.template);
                    }
                    if (Array.isArray(instance.templates)) {
                        instance.templates.forEach(function(template) {
                            if (typeof template === 'string' && template) {
                                templates.push(template);
                            }
                        });
                    }
                }
                config.frontendInstances.push({
                    origin: parsed.origin,
                    type: type,
                    templates: templates
                });
            } catch (_) {}
        });
    }

    return config;
}

function normalizeHostedPlayerConfig(input) {
    input = input || {};
    var config = {
        hostedPlayerUrl: '',
        useHostedPlayer: input.useHostedPlayer !== false
    };

    if (isUsableExternalPlayerUrl(input.hostedPlayerUrl)) {
        config.hostedPlayerUrl = String(input.hostedPlayerUrl).trim();
    }

    return config;
}

function canUseExternalYoutubePlayer() {
    return !!(youtubeExternalPlayerConfig && youtubeExternalPlayerConfig.externalPlayerUrl);
}

function copyObject(source) {
    var copy = {};
    Object.keys(source || {}).forEach(function(key) {
        copy[key] = source[key];
    });
    return copy;
}

function normalizeLanguageCode(value) {
    if (value === undefined || value === null) {
        return '';
    }
    return String(value).trim().replace(/_/g, '-').toLowerCase();
}

function getAudioLanguagePriority(options) {
    var configured = options && Array.isArray(options.audioLanguagePriority)
        ? options.audioLanguagePriority
        : audioLanguagePriority;
    if (!Array.isArray(configured) || !configured.length) {
        configured = ['original', 'en', 'en-us', 'und'];
    }
    return configured.map(normalizeLanguageCode).filter(function(value) { return value !== ''; });
}

function getTrackLanguageScore(track, options) {
    track = track || {};
    var priority = getAudioLanguagePriority(options);
    var values = [
        track.language,
        track.lang,
        track.label,
        track.name,
        track.id,
        track.groupId,
        track.groupID
    ].map(normalizeLanguageCode).filter(function(value) { return value !== ''; });
    var score = track.default === true ? 200 : 0;
    var joined = values.join(' ');

    if (joined.indexOf('original') !== -1 || joined.indexOf('default') !== -1 || joined.indexOf('main') !== -1) {
        score += 900;
    }

    for (var i = 0; i < priority.length; i++) {
        var wanted = priority[i];
        if (!wanted) {
            continue;
        }
        for (var j = 0; j < values.length; j++) {
            var value = values[j];
            if (wanted === 'original' && (value.indexOf('original') !== -1 || value.indexOf('default') !== -1 || value.indexOf('main') !== -1)) {
                score += 800 - (i * 35);
                break;
            }
            if (value === wanted || value.indexOf(wanted + '-') === 0 || wanted.indexOf(value + '-') === 0) {
                score += 700 - (i * 35);
                break;
            }
        }
    }

    return score;
}

function getMediaElementNode(player) {
    if (!player) {
        return null;
    }

    try {
        if (player.youTubeApi && typeof player.youTubeApi.getIframe === 'function') {
            var iframe = player.youTubeApi.getIframe();
            if (!iframe || !iframe.contentWindow || !iframe.contentWindow.document) {
                return null;
            }
            return iframe.contentWindow.document.querySelector('.html5-main-video');
        }
    } catch (_) {
        return null;
    }

    if (player.hlsPlayer && player.hlsPlayer.media) {
        return player.hlsPlayer.media;
    }
    if (player.originalNode) {
        return player.originalNode;
    }
    return player;
}

function getCompanionAudioNode(player) {
    return player && player.pmms && player.pmms.audioCompanion
        ? player.pmms.audioCompanion
        : null;
}

function hasCompanionAudio(player) {
    var audio = getCompanionAudioNode(player);
    return !!(audio && audio.src);
}

function getAudioPlaybackNode(player) {
    return getCompanionAudioNode(player) || getMediaElementNode(player) || player;
}

function getCompanionAudioReady(audio) {
    if (!audio) {
        return false;
    }

    var readyState = Number(audio.readyState);
    var duration = Number(audio.duration);
    return (Number.isFinite(readyState) && readyState >= 2)
        || (Number.isFinite(duration) && duration > 0);
}

function getPlaybackSourceUrl(options) {
    return resolveUrl(options && options.url ? options.url : '');
}

function getUrlPathLower(url) {
    if (typeof url !== 'string') {
        return '';
    }
    try {
        return new URL(url, window.location.href).pathname.toLowerCase();
    } catch (_) {
        return url.split('?')[0].split('#')[0].toLowerCase();
    }
}

function isHlsPlayback(options) {
    if (!options) {
        return false;
    }
    if (options.directLink && String(options.directLink.extension || '').toLowerCase() === 'm3u8') {
        return true;
    }
    var url = String(options.url || options.resolvedUrl || '');
    var lowerUrl = url.toLowerCase();
    return getUrlPathLower(url).indexOf('.m3u8') !== -1
        || lowerUrl.indexOf('.m3u8') !== -1
        || lowerUrl.indexOf('mpegurl') !== -1;
}

function isYoutubeLikeUrl(url) {
    if (typeof url !== 'string' || url === '') {
        return false;
    }
    var lowerUrl = url.toLowerCase();
    return lowerUrl.indexOf('youtube.com/') !== -1
        || lowerUrl.indexOf('youtu.be/') !== -1
        || lowerUrl.indexOf('youtube-nocookie.com/') !== -1;
}

function extractYouTubeVideoId(url) {
    if (typeof url !== 'string' || url === '') {
        return '';
    }

    try {
        var parsed = new URL(url, window.location.href);
        var host = parsed.hostname.toLowerCase().replace(/^www\./, '');
        if (host === 'youtu.be') {
            return parsed.pathname.replace(/^\/+/, '').split('/')[0] || '';
        }
        if (host.indexOf('youtube.com') !== -1 || host.indexOf('youtube-nocookie.com') !== -1) {
            var watchId = parsed.searchParams.get('v');
            if (watchId) {
                return watchId;
            }

            var parts = parsed.pathname.split('/').filter(Boolean);
            var markerIndex = parts.indexOf('embed');
            if (markerIndex !== -1 && parts[markerIndex + 1]) {
                return parts[markerIndex + 1];
            }
            markerIndex = parts.indexOf('shorts');
            if (markerIndex !== -1 && parts[markerIndex + 1]) {
                return parts[markerIndex + 1];
            }
        }
    } catch (_) {}

    var fallback = url.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([A-Za-z0-9_-]{6,})/);
    return fallback ? fallback[1] : '';
}

function getYouTubeStartSeconds(options) {
    var candidates = [
        options && options.offset,
        options && options.start,
        options && options.startSeconds
    ];

    var sourceUrl = options && (options.originalUrl || options.url);
    if (typeof sourceUrl === 'string') {
        try {
            var parsed = new URL(sourceUrl, window.location.href);
            candidates.push(parsed.searchParams.get('t'));
            candidates.push(parsed.searchParams.get('start'));
        } catch (_) {}
    }

    for (var i = 0; i < candidates.length; i++) {
        var parsedTime = parseTimecode(candidates[i]);
        if (Number.isFinite(parsedTime) && parsedTime > 0) {
            return Math.max(0, Math.floor(parsedTime));
        }
    }

    return 0;
}

function isYoutubeEmbedPlayback(options) {
    if (!options) {
        return false;
    }

    var resolver = options.resolver && typeof options.resolver === 'object' ? options.resolver : {};
    var provider = String(options.youtubeProvider
        || options.youtubeResolverProvider
        || options.resolverProvider
        || resolver.provider
        || '').toLowerCase();
    var instance = String(resolver.instance || '').toLowerCase();
    var url = options.originalUrl || options.url || '';

    return (provider === 'embed'
        || provider === 'chromium_youtube'
        || provider === 'youtube_browser'
        || instance === 'youtube_embed'
        || instance === 'youtube_iframe_api')
        && isYoutubeLikeUrl(url)
        && !!extractYouTubeVideoId(url);
}

function parseTwitchPlayback(url) {
    if (typeof url !== 'string' || url === '') {
        return null;
    }

    try {
        var parsed = new URL(url, window.location.href);
        var host = parsed.hostname.toLowerCase().replace(/^www\./, '');
        if (host !== 'twitch.tv' && host !== 'player.twitch.tv') {
            return null;
        }

        var channel = parsed.searchParams.get('channel');
        var video = parsed.searchParams.get('video');
        var path = parsed.pathname.split('/').filter(Boolean);
        if (!channel && path.length === 1 && path[0].toLowerCase() !== 'videos') {
            channel = path[0];
        }
        if (!video && path[0] && path[0].toLowerCase() === 'videos' && path[1]) {
            video = path[1];
        }

        if (video) {
            video = String(video).replace(/^v/i, '').replace(/[^0-9]/g, '');
            return video ? { type: 'video', video: video } : null;
        }

        if (channel && /^[A-Za-z0-9_]{2,32}$/.test(channel)) {
            return { type: 'channel', channel: channel.toLowerCase() };
        }
    } catch (_) {}

    return null;
}

function isTwitchPlayback(options) {
    if (!options) {
        return false;
    }

    var resolver = options.resolver && typeof options.resolver === 'object' ? options.resolver : {};
    var provider = String(options.source || options.provider || resolver.provider || '').toLowerCase();
    var url = options.originalUrl || options.url || '';
    return (provider === 'twitch' || String(url).toLowerCase().indexOf('twitch.tv') !== -1)
        && !!parseTwitchPlayback(url);
}

function loadYouTubeIframeApi(callback) {
    if (youtubeIframeApiReady && window.YT && typeof window.YT.Player === 'function') {
        callback();
        return;
    }

    youtubeIframeApiCallbacks.push(callback);
    if (youtubeIframeApiLoading) {
        return;
    }

    youtubeIframeApiLoading = true;
    var previousReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = function() {
        youtubeIframeApiReady = true;
        youtubeIframeApiLoading = false;
        if (typeof previousReady === 'function') {
            try {
                previousReady();
            } catch (_) {}
        }

        var callbacks = youtubeIframeApiCallbacks.slice();
        youtubeIframeApiCallbacks = [];
        callbacks.forEach(function(queuedCallback) {
            try {
                queuedCallback();
            } catch (_) {}
        });
    };

    var script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = function() {
        youtubeIframeApiLoading = false;
        var callbacks = youtubeIframeApiCallbacks.slice();
        youtubeIframeApiCallbacks = [];
        callbacks.forEach(function(queuedCallback) {
            try {
                queuedCallback(new Error('Could not load the YouTube IFrame API.'));
            } catch (_) {}
        });
    };
    document.head.appendChild(script);
}

function loadTwitchEmbedApi(callback) {
    if (twitchEmbedApiReady && window.Twitch && typeof window.Twitch.Player === 'function') {
        callback();
        return;
    }

    twitchEmbedApiCallbacks.push(callback);
    if (twitchEmbedApiLoading) {
        return;
    }

    twitchEmbedApiLoading = true;
    var script = document.createElement('script');
    script.src = 'https://player.twitch.tv/js/embed/v1.js';
    script.async = true;
    script.onload = function() {
        twitchEmbedApiReady = !!(window.Twitch && typeof window.Twitch.Player === 'function');
        twitchEmbedApiLoading = false;
        var callbacks = twitchEmbedApiCallbacks.slice();
        twitchEmbedApiCallbacks = [];
        callbacks.forEach(function(queuedCallback) {
            try {
                queuedCallback(twitchEmbedApiReady ? null : new Error('Twitch embed API did not expose Twitch.Player.'));
            } catch (_) {}
        });
    };
    script.onerror = function() {
        twitchEmbedApiLoading = false;
        var callbacks = twitchEmbedApiCallbacks.slice();
        twitchEmbedApiCallbacks = [];
        callbacks.forEach(function(queuedCallback) {
            try {
                queuedCallback(new Error('Could not load the Twitch embed API.'));
            } catch (_) {}
        });
    };
    document.head.appendChild(script);
}

function canUseHlsJs() {
    return typeof window.Hls === 'function'
        && window.Hls
        && typeof window.Hls.isSupported === 'function'
        && window.Hls.isSupported();
}

function getPreferredAudioTrack(options) {
    if (!options) {
        return null;
    }
    if (options.audioTrack && typeof options.audioTrack === 'object') {
        return options.audioTrack;
    }
    if (options.selectedAudioTrack && typeof options.selectedAudioTrack === 'object') {
        return options.selectedAudioTrack;
    }
    if (Number.isFinite(Number(options.audioTrackIndex))) {
        return { index: Number(options.audioTrackIndex) };
    }
    if (options.audioTrackId !== undefined && options.audioTrackId !== null) {
        return { id: String(options.audioTrackId) };
    }
    if (typeof options.audioTrackLanguage === 'string' && options.audioTrackLanguage) {
        return { language: options.audioTrackLanguage };
    }
    return null;
}

function normalizeAudioTrackInfo(track, index, selected) {
    track = track || {};
    var label = track.label || track.name || track.title || track.lang || track.language || ('Track ' + (index + 1));
    return {
        index: index,
        id: track.id !== undefined && track.id !== null ? String(track.id) : String(index),
        label: String(label),
        name: track.name || track.label || String(label),
        language: track.lang || track.language || '',
        groupId: track.groupId || track.groupID || '',
        type: track.type || track.audioTrackType || '',
        default: track.default === true,
        selected: selected === true
    };
}

function findMatchingHlsAudioTrackIndex(activeTracks, sourceTrack, fallbackIndex) {
    if (!Array.isArray(activeTracks) || !activeTracks.length) {
        return fallbackIndex;
    }

    for (var i = 0; i < activeTracks.length; i++) {
        var active = activeTracks[i] || {};
        if (sourceTrack && sourceTrack.id !== undefined && active.id !== undefined && String(active.id) === String(sourceTrack.id)) {
            return i;
        }
        if (sourceTrack
            && (active.groupId || active.groupID)
            && (sourceTrack.groupId || sourceTrack.groupID)
            && String(active.groupId || active.groupID) === String(sourceTrack.groupId || sourceTrack.groupID)
            && String(active.name || active.label || active.lang || active.language || '') === String(sourceTrack.name || sourceTrack.label || sourceTrack.lang || sourceTrack.language || '')) {
            return i;
        }
    }

    return fallbackIndex >= 0 && fallbackIndex < activeTracks.length ? fallbackIndex : 0;
}

function getAvailableAudioTracks(media) {
    var tracks = [];
    if (!media) {
        return tracks;
    }

    if (hasCompanionAudio(media)) {
        return [{
            index: 0,
            id: 'resolved-companion-audio',
            label: 'Resolved audio',
            language: '',
            selected: true,
            default: true,
            source: 'companion'
        }];
    }

    if (media.hlsPlayer && (Array.isArray(media.hlsPlayer.audioTracks) || Array.isArray(media.hlsPlayer.allAudioTracks))) {
        media.pmms = media.pmms || {};
        media.pmms.hlsAudioTrackMap = {};
        var selectedHlsTrack = Number(media.hlsPlayer.audioTrack);
        var activeTracks = Array.isArray(media.hlsPlayer.audioTracks) ? media.hlsPlayer.audioTracks : [];
        var sourceTracks = Array.isArray(media.hlsPlayer.allAudioTracks) && media.hlsPlayer.allAudioTracks.length
            ? media.hlsPlayer.allAudioTracks
            : activeTracks;

        sourceTracks.forEach(function(track, index) {
            var activeIndex = findMatchingHlsAudioTrackIndex(activeTracks, track, index);
            var info = normalizeAudioTrackInfo(track, index, activeIndex === selectedHlsTrack);
            info.hlsTrackIndex = activeIndex;
            media.pmms.hlsAudioTrackMap[index] = track;
            tracks.push(info);
        });
        return tracks;
    }

    var node = getMediaElementNode(media);
    var nativeTracks = node && node.audioTracks ? node.audioTracks : null;
    if (nativeTracks && Number.isFinite(Number(nativeTracks.length))) {
        for (var i = 0; i < nativeTracks.length; i++) {
            var nativeTrack = nativeTracks[i];
            tracks.push(normalizeAudioTrackInfo(nativeTrack, i, nativeTrack && nativeTrack.enabled === true));
        }
    }
    return tracks;
}

function getSelectedAudioTrack(media) {
    var tracks = getAvailableAudioTracks(media);
    if (!tracks.length) {
        return null;
    }
    for (var i = 0; i < tracks.length; i++) {
        if (tracks[i].selected) {
            return tracks[i];
        }
    }
    return tracks[0];
}

function getDecodedFrameCount(node) {
    if (!node) {
        return null;
    }

    try {
        if (typeof node.getVideoPlaybackQuality === 'function') {
            var quality = node.getVideoPlaybackQuality();
            if (quality && Number.isFinite(Number(quality.totalVideoFrames))) {
                return Number(quality.totalVideoFrames);
            }
        }
    } catch (_) {}

    if (Number.isFinite(Number(node.webkitDecodedFrameCount))) {
        return Number(node.webkitDecodedFrameCount);
    }

    return null;
}

function hasExternalPlayerStartupEvidence(media) {
    if (!media || !media.externalYoutube) {
        return false;
    }

    if (media.pmms && media.pmms.externalYoutubeReady === true) {
        return true;
    }

    var externalState = media.externalYoutube.state || {};
    return externalState.paused === false
        && Number.isFinite(Number(externalState.currentTime))
        && Number(externalState.currentTime) > 0;
}

function getPlaybackNodeState(media) {
    if (media && media.externalYoutube) {
        var externalState = media.externalYoutube.state || {};
        var externalDuration = Number(externalState.duration) || 0;
        var externalCurrentTime = Number(externalState.currentTime) || 0;
        var externalReady = hasExternalPlayerStartupEvidence(media);

        return {
            node: null,
            readyState: externalReady ? 2 : 0,
            networkState: 1,
            duration: externalDuration,
            currentTime: externalCurrentTime,
            videoWidth: externalReady ? 1 : 0,
            videoHeight: externalReady ? 1 : 0,
            decodedFrames: null,
            hasVideoSize: externalReady,
            hasDecodedFrames: false,
            externalYoutubePaused: externalState.paused === true,
            externalYoutubeMethod: externalState.method || null
        };
    }

    if (media && media.youTubeApi) {
        var ytState = null;
        var ytDuration = 0;
        var ytCurrentTime = 0;
        try {
            if (typeof media.youTubeApi.getPlayerState === 'function') {
                ytState = Number(media.youTubeApi.getPlayerState());
            }
        } catch (_) {}
        try {
            if (typeof media.youTubeApi.getDuration === 'function') {
                ytDuration = Number(media.youTubeApi.getDuration()) || 0;
            }
        } catch (_) {}
        try {
            if (typeof media.youTubeApi.getCurrentTime === 'function') {
                ytCurrentTime = Number(media.youTubeApi.getCurrentTime()) || 0;
            }
        } catch (_) {}

        return {
            node: null,
            readyState: ytState === 1 || ytState === 2 || ytState === 3 || ytState === 5 ? 2 : 0,
            networkState: ytState === null ? 0 : 1,
            duration: ytDuration,
            currentTime: ytCurrentTime,
            videoWidth: media.pmms && media.pmms.youtubeReady ? 1 : 0,
            videoHeight: media.pmms && media.pmms.youtubeReady ? 1 : 0,
            decodedFrames: null,
            hasVideoSize: media.pmms && media.pmms.youtubeReady === true,
            hasDecodedFrames: false,
            youtubeState: ytState
        };
    }

    if (media && media.twitchApi) {
        var twitchDuration = 0;
        var twitchCurrentTime = 0;
        var twitchPaused = false;
        try {
            twitchDuration = Number(media.twitchApi.getDuration && media.twitchApi.getDuration()) || 0;
        } catch (_) {}
        try {
            twitchCurrentTime = Number(media.twitchApi.getCurrentTime && media.twitchApi.getCurrentTime()) || 0;
        } catch (_) {}
        try {
            twitchPaused = media.twitchApi.isPaused && media.twitchApi.isPaused() === true;
        } catch (_) {}

        return {
            node: null,
            readyState: media.pmms && media.pmms.twitchReady ? 2 : 0,
            networkState: 1,
            duration: twitchDuration,
            currentTime: twitchCurrentTime,
            videoWidth: media.pmms && media.pmms.twitchReady ? 1 : 0,
            videoHeight: media.pmms && media.pmms.twitchReady ? 1 : 0,
            decodedFrames: null,
            hasVideoSize: media.pmms && media.pmms.twitchReady === true,
            hasDecodedFrames: false,
            twitchPaused: twitchPaused
        };
    }

    var node = getMediaElementNode(media) || media;
    var fallback = node === media ? null : media;
    var audioNode = getCompanionAudioNode(media);
    var audioReadyState = Number(audioNode && audioNode.readyState);
    var audioNetworkState = Number(audioNode && audioNode.networkState);
    var audioDuration = Number(audioNode && audioNode.duration);
    var audioCurrentTime = Number(audioNode && audioNode.currentTime);

    var readyState = Number(node && node.readyState);
    if (!Number.isFinite(readyState) && fallback) {
        readyState = Number(fallback.readyState);
    }
    if (!Number.isFinite(readyState)) {
        readyState = 0;
    }

    var networkState = Number(node && node.networkState);
    if (!Number.isFinite(networkState) && fallback) {
        networkState = Number(fallback.networkState);
    }

    var duration = Number(node && node.duration);
    if ((!Number.isFinite(duration) || duration <= 0) && fallback) {
        duration = Number(fallback.duration);
    }
    if ((!Number.isFinite(duration) || duration <= 0) && Number.isFinite(audioDuration) && audioDuration > 0) {
        duration = audioDuration;
    }

    var currentTime = Number(node && node.currentTime);
    if (!Number.isFinite(currentTime) && fallback) {
        currentTime = Number(fallback.currentTime);
    }
    if (!Number.isFinite(currentTime) && Number.isFinite(audioCurrentTime)) {
        currentTime = audioCurrentTime;
    }

    var videoWidth = Number(node && node.videoWidth) || 0;
    var videoHeight = Number(node && node.videoHeight) || 0;
    var decodedFrames = getDecodedFrameCount(node);

    return {
        node: node,
        readyState: readyState,
        networkState: networkState,
        duration: Number.isFinite(duration) ? duration : 0,
        currentTime: Number.isFinite(currentTime) ? currentTime : 0,
        videoWidth: videoWidth,
        videoHeight: videoHeight,
        decodedFrames: decodedFrames,
        hasVideoSize: videoWidth > 0 || videoHeight > 0,
        hasDecodedFrames: Number.isFinite(decodedFrames) && decodedFrames > 0,
        hasCompanionAudio: !!audioNode,
        audioReadyState: Number.isFinite(audioReadyState) ? audioReadyState : 0,
        audioNetworkState: Number.isFinite(audioNetworkState) ? audioNetworkState : 0,
        audioDuration: Number.isFinite(audioDuration) ? audioDuration : 0,
        audioCurrentTime: Number.isFinite(audioCurrentTime) ? audioCurrentTime : 0,
        hasAudioReady: getCompanionAudioReady(audioNode)
    };
}

function callMediaPlaybackMethod(media, methodName) {
    if (media && media.externalYoutube && typeof media.externalYoutube.post === 'function') {
        try {
            if (methodName === 'play' || methodName === 'pause') {
                media.externalYoutube.post({ command: methodName });
                return true;
            }
        } catch (_) {}
    }

    if (media && media.youTubeApi) {
        try {
            if (methodName === 'play' && typeof media.youTubeApi.playVideo === 'function') {
                media.youTubeApi.playVideo();
                return true;
            }
            if (methodName === 'pause' && typeof media.youTubeApi.pauseVideo === 'function') {
                media.youTubeApi.pauseVideo();
                return true;
            }
        } catch (_) {}
    }

    if (media && media.twitchApi) {
        try {
            if (methodName === 'play' && typeof media.twitchApi.play === 'function') {
                media.twitchApi.play();
                return true;
            }
            if (methodName === 'pause' && typeof media.twitchApi.pause === 'function') {
                media.twitchApi.pause();
                return true;
            }
        } catch (_) {}
    }

    var node = getMediaElementNode(media);
    var companionAudio = getCompanionAudioNode(media);
    var called = false;

    if (node && node !== media && typeof node[methodName] === 'function') {
        try {
            node[methodName]();
            called = true;
        } catch (_) {}
    }

    if (media && typeof media[methodName] === 'function') {
        try {
            media[methodName]();
            called = true;
        } catch (_) {}
    }

    if (companionAudio && typeof companionAudio[methodName] === 'function') {
        try {
            if (methodName === 'play') {
                var primaryNode = node || media;
                var primaryTime = Number(primaryNode && primaryNode.currentTime);
                var audioTime = Number(companionAudio.currentTime);
                if (Number.isFinite(primaryTime) && (!Number.isFinite(audioTime) || Math.abs(primaryTime - audioTime) > 0.35)) {
                    companionAudio.currentTime = primaryTime;
                }
            }
            var companionResult = companionAudio[methodName]();
            if (companionResult && typeof companionResult.catch === 'function') {
                companionResult.catch(function() {});
            }
            called = true;
        } catch (_) {}
    }

    return called;
}

function setMediaCurrentTime(media, value) {
    var numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
        return false;
    }

    if (media && media.externalYoutube && typeof media.externalYoutube.post === 'function') {
        try {
            media.externalYoutube.post({ command: 'seek', seconds: numericValue });
            return true;
        } catch (_) {}
    }

    if (media && media.youTubeApi && typeof media.youTubeApi.seekTo === 'function') {
        try {
            media.youTubeApi.seekTo(numericValue, true);
            return true;
        } catch (_) {}
    }

    if (media && media.twitchApi && typeof media.twitchApi.seek === 'function') {
        try {
            media.twitchApi.seek(numericValue);
            return true;
        } catch (_) {}
    }

    var node = getMediaElementNode(media);
    var applied = false;
    if (node && node !== media) {
        try {
            node.currentTime = numericValue;
            applied = true;
        } catch (_) {}
    }

    if (media) {
        try {
            media.currentTime = numericValue;
            applied = true;
        } catch (_) {}
    }

    var companionAudio = getCompanionAudioNode(media);
    if (companionAudio) {
        try {
            companionAudio.currentTime = numericValue;
            applied = true;
        } catch (_) {}
    }

    return applied;
}

function syncCompanionAudio(media, force) {
    var companionAudio = getCompanionAudioNode(media);
    if (!companionAudio) {
        return false;
    }

    var primaryNode = getMediaElementNode(media) || media;
    if (!primaryNode || primaryNode === companionAudio) {
        return false;
    }

    var primaryTime = Number(primaryNode.currentTime);
    var audioTime = Number(companionAudio.currentTime);
    if (Number.isFinite(primaryTime) && (force || !Number.isFinite(audioTime) || Math.abs(primaryTime - audioTime) > 0.35)) {
        try {
            companionAudio.currentTime = primaryTime;
        } catch (_) {}
    }

    var primaryPaused = primaryNode.paused === true || primaryNode.ended === true;
    if (primaryPaused && companionAudio.paused !== true) {
        try {
            companionAudio.pause();
        } catch (_) {}
    } else if (!primaryPaused && companionAudio.paused === true) {
        try {
            var playResult = companionAudio.play();
            if (playResult && typeof playResult.catch === 'function') {
                playResult.catch(function() {});
            }
        } catch (_) {}
    }

    return true;
}

function setMediaDisplay(media, visible) {
    var display = visible ? 'block' : 'none';
    var hasCanvas = !!(media && media.pmms && media.pmms.hlsCanvas);

    if (media && media.style) {
        media.style.display = display;
        if (hasCanvas) {
            media.style.visibility = visible ? 'hidden' : 'hidden';
        }
    }

    var node = getMediaElementNode(media);
    if (node && node !== media && node.style) {
        node.style.display = display;
        if (hasCanvas) {
            node.style.visibility = visible ? 'hidden' : 'hidden';
        }
    }

    if (hasCanvas && media.pmms.hlsCanvas.style) {
        media.pmms.hlsCanvas.style.display = visible ? 'block' : 'none';
    }
}

function hasExpectedVideoTrack(media, options) {
    if (!media || (options && options.video === false)) {
        return false;
    }

    var node = getMediaElementNode(media) || media;
    if (!node) {
        return false;
    }

    if (Number(node.videoWidth) > 0 || Number(node.videoHeight) > 0) {
        return true;
    }

    if (media.hlsPlayer && Array.isArray(media.hlsPlayer.levels) && media.hlsPlayer.levels.length > 0) {
        return true;
    }

    if (node.videoTracks && Number(node.videoTracks.length) > 0) {
        return true;
    }

    return false;
}

function normalizeHlsLevelInfo(level, index) {
    level = level || {};
    var attrs = level.attrs || {};
    var codecs = [
        level.codecs,
        level.codecSet,
        level.videoCodec,
        level.audioCodec,
        attrs.CODECS
    ].filter(function(value) {
        return typeof value === 'string' && value;
    }).join(',').toLowerCase();
    var videoRange = String(level.videoRange || attrs['VIDEO-RANGE'] || attrs.VIDEO_RANGE || '').toLowerCase();
    var width = Number(level.width) || 0;
    var height = Number(level.height) || 0;
    var hdr = videoRange.indexOf('pq') !== -1
        || videoRange.indexOf('hlg') !== -1
        || videoRange.indexOf('hdr') !== -1
        || codecs.indexOf('hvc1') !== -1
        || codecs.indexOf('hev1') !== -1
        || codecs.indexOf('dvh') !== -1;
    var maxWidth = Number(hlsCanvasConfig.maxWidth) || 1920;
    var maxHeight = Number(hlsCanvasConfig.maxHeight) || 1080;
    var oversized = width > maxWidth || height > maxHeight;

    return {
        index: index,
        width: width,
        height: height,
        codecs: codecs,
        videoRange: videoRange,
        hdr: hdr,
        oversized: oversized,
        cefFriendly: !hdr && !oversized
    };
}

function getHlsLevelCompatibility(levels) {
    if (!Array.isArray(levels) || !levels.length) {
        return {
            levels: [],
            bestCompatibleIndex: -1,
            warning: null,
            needsCanvasDownscale: false
        };
    }

    var normalized = levels.map(normalizeHlsLevelInfo);
    var knownVideoLevels = normalized.filter(function(level) {
        return level.width > 0 || level.height > 0 || level.codecs || level.videoRange;
    });

    if (!knownVideoLevels.length) {
        return {
            levels: normalized,
            bestCompatibleIndex: -1,
            warning: null,
            needsCanvasDownscale: false
        };
    }

    var compatible = knownVideoLevels.filter(function(level) {
        return level.cefFriendly;
    });
    var hasHdr = knownVideoLevels.some(function(level) { return level.hdr; });
    var hasOversized = knownVideoLevels.some(function(level) { return level.oversized; });
    var warning = null;
    if (hasHdr && hasOversized) {
        warning = 'This HLS stream exposes 4K/HDR-style variants. FiveM CEF may still fail unless the codec is browser-decodable; canvas downscale cannot transcode HEVC/HDR/DRM.';
    } else if (hasHdr) {
        warning = 'This HLS stream exposes HDR/HEVC-style variants. FiveM CEF usually needs SDR H.264/AAC; playback will be attempted anyway.';
    } else if (hasOversized) {
        warning = 'This HLS stream exposes video above the configured DUI canvas size. Playback will be attempted and downscaled if CEF can decode it.';
    }

    if (!compatible.length) {
        return {
            levels: normalized,
            bestCompatibleIndex: -1,
            warning: warning || 'This HLS stream only exposes video variants that FiveM DUI may not render; playback will still be attempted.',
            needsCanvasDownscale: hasOversized
        };
    }

    compatible.sort(function(a, b) {
        var aPixels = (a.width || 0) * (a.height || 0);
        var bPixels = (b.width || 0) * (b.height || 0);
        return bPixels - aPixels;
    });

    return {
        levels: normalized,
        bestCompatibleIndex: compatible[0].index,
        warning: warning,
        needsCanvasDownscale: hasOversized
    };
}

function cleanupHlsCanvas(media) {
    if (!media || !media.pmms) {
        return;
    }

    if (media.pmms.hlsCanvasAnimationId) {
        cancelAnimationFrame(media.pmms.hlsCanvasAnimationId);
        media.pmms.hlsCanvasAnimationId = null;
    }

    if (media.pmms.hlsCanvas && media.pmms.hlsCanvas.parentNode) {
        media.pmms.hlsCanvas.remove();
    }

    var node = getMediaElementNode(media) || media;
    if (node && node.style) {
        node.style.visibility = '';
    }
    if (media.style) {
        media.style.visibility = '';
    }

    media.pmms.hlsCanvas = null;
    media.pmms.hlsCanvasContext = null;
    media.pmms.hlsCanvasError = null;
}

function getCanvasOutputSize(sourceWidth, sourceHeight) {
    var maxWidth = Math.max(320, Number(hlsCanvasConfig.maxWidth) || 1920);
    var maxHeight = Math.max(180, Number(hlsCanvasConfig.maxHeight) || 1080);
    var width = Math.max(1, Number(sourceWidth) || maxWidth);
    var height = Math.max(1, Number(sourceHeight) || maxHeight);
    var ratio = Math.min(maxWidth / width, maxHeight / height, 1);
    return {
        width: Math.max(1, Math.round(width * ratio)),
        height: Math.max(1, Math.round(height * ratio))
    };
}

function drawHlsCanvasFrame(media) {
    if (!media || !media.pmms || media.pmms.removed === true || !media.pmms.hlsCanvas) {
        return;
    }

    var node = getMediaElementNode(media) || media;
    var canvas = media.pmms.hlsCanvas;
    var context = media.pmms.hlsCanvasContext;
    if (!node || !context) {
        return;
    }

    var fps = Math.max(1, Math.min(60, Number(hlsCanvasConfig.maxFps) || 30));
    var now = getNowMs();
    var minDelta = 1000 / fps;
    if (!media.pmms.hlsCanvasLastDrawAt || (now - media.pmms.hlsCanvasLastDrawAt) >= minDelta) {
        media.pmms.hlsCanvasLastDrawAt = now;

        if (Number(node.readyState) >= 2 && Number(node.videoWidth) > 0 && Number(node.videoHeight) > 0) {
            var output = getCanvasOutputSize(node.videoWidth, node.videoHeight);
            if (canvas.width !== output.width || canvas.height !== output.height) {
                canvas.width = output.width;
                canvas.height = output.height;
            }

            try {
                context.clearRect(0, 0, canvas.width, canvas.height);
                context.drawImage(node, 0, 0, canvas.width, canvas.height);
                media.pmms.hlsCanvasDrawErrors = 0;
            } catch (error) {
                media.pmms.hlsCanvasDrawErrors = (Number(media.pmms.hlsCanvasDrawErrors) || 0) + 1;
                media.pmms.hlsCanvasError = 'FiveM CEF decoded the stream but could not draw it to the DUI canvas. The HLS server may block canvas drawing with CORS, or the codec is not drawable.';
                if (media.pmms.hlsCanvasDrawErrors >= 6 && typeof media.pmms.reportPlaybackFailure === 'function') {
                    media.pmms.reportPlaybackFailure(media.pmms.hlsCanvasError);
                    return;
                }
            }
        }
    }

    media.pmms.hlsCanvasAnimationId = requestAnimationFrame(function() {
        drawHlsCanvasFrame(media);
    });
}

function ensureHlsCanvasDownscale(media, options, compatibility) {
    if (!media || !media.pmms || options && options.video === false) {
        return false;
    }
    if (hlsCanvasConfig.enabled === false || !(compatibility && compatibility.needsCanvasDownscale)) {
        return false;
    }
    if (media.pmms.hlsCanvas) {
        return true;
    }

    var canvas = document.createElement('canvas');
    canvas.id = (media.id || 'pmms_player') + '_hls_canvas';
    canvas.className = 'pmms-hls-canvas';
    canvas.setAttribute('aria-hidden', 'true');

    var context = null;
    try {
        context = canvas.getContext('2d', { alpha: false, desynchronized: true });
    } catch (_) {
        context = null;
    }
    if (!context) {
        media.pmms.hlsCanvasError = 'FiveM CEF could not create the HLS downscale canvas.';
        return false;
    }

    document.body.appendChild(canvas);
    media.pmms.hlsCanvas = canvas;
    media.pmms.hlsCanvasContext = context;
    media.pmms.hlsCanvasLastDrawAt = 0;

    var node = getMediaElementNode(media) || media;
    if (node && node.style) {
        node.style.visibility = 'hidden';
    }
    if (media.style) {
        media.style.visibility = 'hidden';
    }

    drawHlsCanvasFrame(media);
    debugLog('dui_browser', 'hls canvas downscale enabled', {
        maxWidth: hlsCanvasConfig.maxWidth,
        maxHeight: hlsCanvasConfig.maxHeight,
        maxFps: hlsCanvasConfig.maxFps,
        warning: compatibility.warning || null
    });
    return true;
}

function findPreferredAudioTrackIndex(tracks, preferred, useDefaultFallback, options) {
    if (!Array.isArray(tracks) || !tracks.length) {
        return -1;
    }

    if (preferred && Number.isFinite(Number(preferred.index))) {
        var preferredIndex = Number(preferred.index);
        if (preferredIndex >= 0 && preferredIndex < tracks.length) {
            return preferredIndex;
        }
    }

    if (preferred && preferred.id !== undefined && preferred.id !== null) {
        var preferredId = String(preferred.id);
        for (var byId = 0; byId < tracks.length; byId++) {
            if (String(tracks[byId].id) === preferredId) {
                return byId;
            }
        }
    }

    if (preferred && typeof preferred.language === 'string' && preferred.language) {
        var wantedLanguage = preferred.language.toLowerCase();
        for (var byLanguage = 0; byLanguage < tracks.length; byLanguage++) {
            if (String(tracks[byLanguage].language || '').toLowerCase() === wantedLanguage) {
                return byLanguage;
            }
        }
    }

    if (useDefaultFallback) {
        var bestLanguageIndex = -1;
        var bestLanguageScore = 0;
        for (var byLanguagePreference = 0; byLanguagePreference < tracks.length; byLanguagePreference++) {
            var languageScore = getTrackLanguageScore(tracks[byLanguagePreference], options);
            if (languageScore > bestLanguageScore) {
                bestLanguageScore = languageScore;
                bestLanguageIndex = byLanguagePreference;
            }
        }
        if (bestLanguageIndex >= 0) {
            return bestLanguageIndex;
        }

        for (var byDefault = 0; byDefault < tracks.length; byDefault++) {
            if (tracks[byDefault].default === true) {
                return byDefault;
            }
        }
        return 0;
    }

    return -1;
}

function applyPreferredAudioTrack(media, options, useDefaultFallback) {
    if (!media) {
        return false;
    }

    var preferred = getPreferredAudioTrack(options);
    var tracks = getAvailableAudioTracks(media);
    if (!tracks.length) {
        return false;
    }

    var selectedIndex = findPreferredAudioTrackIndex(tracks, preferred, useDefaultFallback === true, options);
    if (selectedIndex < 0) {
        return false;
    }

    if (hasCompanionAudio(media)) {
        media.pmms = media.pmms || {};
        media.pmms.audioTrack = tracks[selectedIndex] || tracks[0];
        return true;
    }

    if (media.hlsPlayer && (Array.isArray(media.hlsPlayer.audioTracks) || Array.isArray(media.hlsPlayer.allAudioTracks))) {
        var selectedTrack = tracks[selectedIndex] || {};
        var hlsTrackIndex = Number.isFinite(Number(selectedTrack.hlsTrackIndex)) ? Number(selectedTrack.hlsTrackIndex) : selectedIndex;
        var rawTrack = media.pmms && media.pmms.hlsAudioTrackMap ? media.pmms.hlsAudioTrackMap[selectedIndex] : null;
        if (rawTrack && typeof media.hlsPlayer.setAudioOption === 'function') {
            try {
                media.hlsPlayer.setAudioOption(rawTrack);
                return true;
            } catch (_) {}
        }
        if (Number(media.hlsPlayer.audioTrack) !== hlsTrackIndex) {
            media.hlsPlayer.audioTrack = hlsTrackIndex;
        }
        return true;
    }

    var node = getMediaElementNode(media);
    var nativeTracks = node && node.audioTracks ? node.audioTracks : null;
    if (nativeTracks && Number.isFinite(Number(nativeTracks.length))) {
        for (var i = 0; i < nativeTracks.length; i++) {
            nativeTracks[i].enabled = i === selectedIndex;
        }
        return true;
    }

    return false;
}

function setupHlsPlayback(media, options, completeMediaInitialization, reportPlaybackFailure) {
    if (!isHlsPlayback(options)) {
        return false;
    }

    var sourceUrl = getPlaybackSourceUrl(options);
    if (!sourceUrl) {
        return false;
    }

    if (!canUseHlsJs()) {
        media.src = sourceUrl;
        debugLog('dui_browser', 'hls.js unavailable, trying native HLS playback', {
            url: redactUrlForDebug(sourceUrl)
        });
        return false;
    }

    if (media.hlsPlayer && typeof media.hlsPlayer.destroy === 'function') {
        try {
            media.hlsPlayer.destroy();
        } catch (_) {}
    }

    var hls = new window.Hls({
        enableWorker: false,
        lowLatencyMode: false,
        backBufferLength: 60,
        maxBufferLength: 30,
        maxMaxBufferLength: 90,
        manifestLoadingTimeOut: 15000,
        manifestLoadingMaxRetry: 3,
        manifestLoadingRetryDelay: 700,
        levelLoadingTimeOut: 15000,
        levelLoadingMaxRetry: 4,
        levelLoadingRetryDelay: 700,
        fragLoadingTimeOut: 18000,
        fragLoadingMaxRetry: 6,
        fragLoadingRetryDelay: 500,
        startFragPrefetch: true,
        capLevelToPlayerSize: true
    });

    var hlsMediaElement = getMediaElementNode(media) || media;
    media.hlsPlayer = hls;
    media.pmms = media.pmms || {};
    media.pmms.hlsRecoveries = { network: 0, media: 0 };
    hls.on(window.Hls.Events.MEDIA_ATTACHED, function() {
        debugLog('dui_browser', 'hls media attached', {
            url: redactUrlForDebug(sourceUrl)
        });
        hls.loadSource(sourceUrl);
    });
    hls.on(window.Hls.Events.MANIFEST_PARSED, function(_, data) {
        var levels = data && Array.isArray(data.levels) ? data.levels : (Array.isArray(hls.levels) ? hls.levels : []);
        var compatibility = getHlsLevelCompatibility(levels);
        media.pmms.hlsManifest = {
            levelCount: levels.length,
            audioTrackCount: data && Array.isArray(data.audioTracks) ? data.audioTracks.length : (hls.audioTracks ? hls.audioTracks.length : 0),
            levels: compatibility.levels
        };
        media.pmms.hlsCompatibilityWarning = compatibility.warning || null;
        media.pmms.hlsCompatibilityError = null;
        if (compatibility.bestCompatibleIndex >= 0) {
            try {
                hls.autoLevelCapping = compatibility.bestCompatibleIndex;
            } catch (_) {}
        }
        ensureHlsCanvasDownscale(media, options, compatibility);
        applyPreferredAudioTrack(media, options, true);
        callMediaPlaybackMethod(media, 'play');
        schedulePlaybackMetadataUpdate(media, options, 'hls_manifest');
    });
    hls.on(window.Hls.Events.LEVEL_LOADED, function(_, data) {
        if (data && data.details) {
            media.pmms.hlsLevelDetails = data.details;
        }
        schedulePlaybackMetadataUpdate(media, options, 'hls_level_loaded');
    });
    hls.on(window.Hls.Events.AUDIO_TRACKS_UPDATED, function() {
        applyPreferredAudioTrack(media, options, true);
        debugLog('dui_browser', 'hls audio tracks updated', {
            audioTracks: getAvailableAudioTracks(media)
        });
        schedulePlaybackMetadataUpdate(media, options, 'hls_audio_tracks');
    });
    hls.on(window.Hls.Events.AUDIO_TRACK_SWITCHED, function() {
        media.pmms = media.pmms || {};
        media.pmms.audioTrack = getSelectedAudioTrack(media);
        schedulePlaybackMetadataUpdate(media, options, 'hls_audio_track_switched');
    });
    if (window.Hls.Events.FRAG_BUFFERED) {
        hls.on(window.Hls.Events.FRAG_BUFFERED, function() {
            completeMediaInitialization('hls_buffered');
        });
    }
    hls.on(window.Hls.Events.ERROR, function(_, data) {
        media.pmms.lastHlsError = data ? {
            type: data.type || null,
            details: data.details || null,
            fatal: data.fatal === true
        } : null;

        if (!data || data.fatal !== true) {
            return;
        }

        var errorTypes = window.Hls.ErrorTypes || {};
        var recovery = media.pmms.hlsRecoveries || { network: 0, media: 0 };
        if (data.type === errorTypes.NETWORK_ERROR && recovery.network < 3) {
            recovery.network += 1;
            media.pmms.hlsRecoveries = recovery;
            debugLog('dui_browser', 'recovering fatal hls network error', {
                attempt: recovery.network,
                details: data.details || null
            });
            try {
                hls.startLoad();
                return;
            } catch (_) {}
        }

        if (data.type === errorTypes.MEDIA_ERROR && recovery.media < 2) {
            recovery.media += 1;
            media.pmms.hlsRecoveries = recovery;
            debugLog('dui_browser', 'recovering fatal hls media error', {
                attempt: recovery.media,
                details: data.details || null
            });
            try {
                hls.recoverMediaError();
                return;
            } catch (_) {}
        }

        var message = data.details || data.type || 'HLS playback failed.';
        if (media.pmms.hlsCompatibilityWarning) {
            message = message + '. ' + media.pmms.hlsCompatibilityWarning;
        }
        if (media.pmms.hlsCanvasError) {
            message = message + '. ' + media.pmms.hlsCanvasError;
        }
        reportPlaybackFailure('HLS playback failed: ' + message);
    });
    hls.attachMedia(hlsMediaElement);
    return true;
}

function setupCompanionAudio(media, options, reportPlaybackFailure) {
    if (!media || !options || options.pairedStreams !== true || typeof options.audioUrl !== 'string' || options.audioUrl === '') {
        return null;
    }

    var audio = document.createElement('audio');
    audio.preload = 'auto';
    audio.src = resolveUrl(options.audioUrl);
    audio.style.display = 'none';
    audio.dataset.pmmsCompanionAudio = '1';
    audio.dataset.handle = media.dataset && media.dataset.handle ? media.dataset.handle : '';
    audio.volume = 0;
    audio.muted = true;

    media.pmms = media.pmms || {};
    media.pmms.audioCompanion = audio;
    media.pmms.audioUrl = options.audioUrl;
    media.pmms.pairedStreams = true;

    audio.addEventListener('error', function() {
        if (!media.pmms || media.pmms.removed === true || typeof reportPlaybackFailure !== 'function') {
            return;
        }
        reportPlaybackFailure(getPlaybackErrorMessage(audio, 'Companion audio playback failed.'));
    });

    audio.addEventListener('playing', function() {
        syncCompanionAudio(media, false);
    });

    document.body.appendChild(audio);
    try {
        audio.load();
    } catch (_) {}

    return audio;
}

function getPlayerDocument(player) {
    try {
        if (player && player.youTubeApi && typeof player.youTubeApi.getIframe === 'function') {
            var iframe = player.youTubeApi.getIframe();
            if (iframe && iframe.contentWindow && iframe.contentWindow.document) {
                return iframe.contentWindow.document;
            }
        }
    } catch (_) {}

    return document;
}

function cleanupAudioGraph(player) {
    if (!player || !player.pmms || !player.pmms.audioGraph) {
        return;
    }

    var graph = player.pmms.audioGraph;
    ['source', 'splitter', 'merger', 'gainNode', 'lowpass', 'highpass'].forEach(function(key) {
        if (graph[key] && typeof graph[key].disconnect === 'function') {
            try {
                graph[key].disconnect();
            } catch (_) {}
        }
    });

    if (graph.context && typeof graph.context.close === 'function') {
        try {
            graph.context.close();
        } catch (_) {}
    }

    player.pmms.audioGraph = null;
    player.pmms.filterAdded = false;
}

function cleanupWaveEntry(elementId) {
    if (!elementId || !window.$wave || !window.$wave[elementId]) {
        return;
    }

    var entry = window.$wave[elementId];
    ['source', 'analyser'].forEach(function(key) {
        if (entry[key] && typeof entry[key].disconnect === 'function') {
            try {
                entry[key].disconnect();
            } catch (_) {}
        }
    });

    if (entry.audioCtx && typeof entry.audioCtx.close === 'function') {
        try {
            entry.audioCtx.close();
        } catch (_) {}
    }

    delete window.$wave[elementId];
}

function cleanupVisualization(player) {
    if (!player || !player.pmms) {
        return;
    }

    var waveCanvasId = player.pmms.visualizationCanvasId || (player.id + '_visualization');
    var waveCanvas = document.getElementById(waveCanvasId);
    if (waveCanvas) {
        waveCanvas.remove();
    }

    cleanupWaveEntry(player.pmms.visualizationElementId);

    var mediaNode = getMediaElementNode(player);
    if (mediaNode && mediaNode.style) {
        mediaNode.style.visibility = '';
    }

    try {
        if (player.youTubeApi && typeof player.youTubeApi.getIframe === 'function') {
            var iframe = player.youTubeApi.getIframe();
            if (iframe && iframe.style) {
                iframe.style.visibility = '';
            }
        }
    } catch (_) {}

    player.pmms.wave = null;
    player.pmms.visualizationCanvasId = null;
    player.pmms.visualizationElementId = null;
    player.pmms.visualizationAdded = false;
}

function disposePlayerEnhancements(player) {
    cleanupHlsCanvas(player);
    cleanupAudioGraph(player);
    cleanupVisualization(player);
}

function clearStartupWatchdog(player) {
    if (!player || !player.pmms || !player.pmms.startupWatchdogId) {
        return;
    }

    clearTimeout(player.pmms.startupWatchdogId);
    player.pmms.startupWatchdogId = null;
}

function clearStartupSignalHandlers(player) {
    if (!player || !player.pmms) {
        return;
    }

    var cleanupFns = Array.isArray(player.pmms.startupCleanupFns) ? player.pmms.startupCleanupFns.slice() : [];
    player.pmms.startupCleanupFns = [];

    cleanupFns.forEach(function(cleanup) {
        if (typeof cleanup !== 'function') {
            return;
        }

        try {
            cleanup();
        } catch (_) {}
    });
}

function setStartupSignalHandlers(player, cleanupFns) {
    ensurePlayerState(player);
    clearStartupSignalHandlers(player);
    player.pmms.startupCleanupFns = Array.isArray(cleanupFns) ? cleanupFns.slice() : [];
}

function getTrackedStartupToken(player) {
    if (!player || !player.pmms) {
        return null;
    }

    return player.pmms.startupPlaybackToken || player.pmms.playbackToken || null;
}

function isCurrentStartupAttempt(player, attemptId, playbackToken) {
    if (!player || !player.pmms || player.pmms.removed === true || !attemptId) {
        return false;
    }

    if (String(player.pmms.startupAttemptId || '') !== String(attemptId || '')) {
        return false;
    }

    var trackedToken = getTrackedStartupToken(player);
    if (playbackToken && String(trackedToken || '') !== String(playbackToken || '')) {
        return false;
    }

    return true;
}

function resetStartupAttempt(player) {
    if (!player || !player.pmms) {
        return;
    }

    clearStartupWatchdog(player);
    clearStartupSignalHandlers(player);
    player.pmms.startupAttemptId = null;
    player.pmms.startupPlaybackToken = null;
    player.pmms.startupReadySent = false;
    player.pmms.awaitingActivation = false;
}

function finishStartupAttempt(player, handle, result, details) {
    ensurePlayerState(player);

    var currentAttemptId = player.pmms.startupAttemptId || null;
    var currentPlaybackToken = getTrackedStartupToken(player);
    if (!isCurrentStartupAttempt(
        player,
        details && details.attemptId !== undefined ? details.attemptId : currentAttemptId,
        details && details.playbackToken !== undefined ? details.playbackToken : currentPlaybackToken
    )) {
        return false;
    }

    var url = details && details.url ? details.url : player.pmms.currentUrl;
    if (result === 'ready') {
        if (player.pmms.startupReadySent) {
            return false;
        }

        player.pmms.startupReadySent = true;
        player.pmms.awaitingActivation = true;
        clearStartupWatchdog(player);
        clearStartupSignalHandlers(player);
        notifyStartupReady(handle, currentAttemptId, currentPlaybackToken, details && details.metadata ? details.metadata : {});
        removeStalePlayersForHandle(handle);
        callMediaPlaybackMethod(player, 'pause');
        return true;
    }

    resetStartupAttempt(player);

    if (result === 'local_error') {
        notifyLocalError(handle, url, details && details.message ? details.message : 'Playback failed.', currentPlaybackToken);
        return true;
    }

    notifyStartupError(
        handle,
        currentAttemptId,
        currentPlaybackToken,
        url,
        details && details.message ? details.message : 'Playback failed.'
    );
    return true;
}

function canFinishStartupReady(media, signal) {
    if (!media) {
        return false;
    }

    var state = getPlaybackNodeState(media);
    var readyState = state.readyState;
    var needsCompanionAudio = !!(media.pmms && media.pmms.pairedStreams && getCompanionAudioNode(media));
    var companionReady = !needsCompanionAudio || state.hasAudioReady;

    if (signal === 'youtube_ready') {
        return state.youtubeState === 1 || state.youtubeState === 2 || state.youtubeState === 3;
    }

    if (signal === 'youtube_playing' || signal === 'youtube_paused') {
        return !!(media.pmms && media.pmms.youtubeReady === true);
    }

    if (signal === 'external_youtube_playing' || signal === 'external_youtube_paused' || signal === 'external_youtube_ready') {
        return hasExternalPlayerStartupEvidence(media);
    }

    if (signal === 'twitch_playing' || signal === 'twitch_ready') {
        return !!(media.pmms && media.pmms.twitchReady === true);
    }

    if (signal === 'canplay' || signal === 'playing') {
        return companionReady;
    }

    if (signal === 'hls_buffered') {
        return companionReady && (readyState >= 2 || state.hasDecodedFrames || state.hasVideoSize);
    }

    if (signal === 'loadedmetadata') {
        return companionReady && (readyState >= 1 || state.hasVideoSize);
    }

    if (signal === 'poll') {
        if (readyState >= 2 && companionReady) {
            return true;
        }

        if (companionReady && (state.hasDecodedFrames || state.hasVideoSize)) {
            return true;
        }

        if (!(media.pmms && media.pmms.providerBackedStartup) && companionReady && readyState >= 1 && state.duration > 0) {
            return true;
        }

        if (media.youTubeApi) {
            try {
                if (typeof media.youTubeApi.getDuration === 'function' && Number(media.youTubeApi.getDuration()) > 0) {
                    return true;
                }
                if (typeof media.youTubeApi.getPlayerState === 'function') {
                    var state = Number(media.youTubeApi.getPlayerState());
                    if (state === 1 || state === 2 || state === 3 || state === 5) {
                        return true;
                    }
                }
            } catch (_) {}
        }

        return false;
    }

    if (signal === 'activation_grace') {
        if (media.pmms && media.pmms.providerBackedStartup) {
            return false;
        }

        if (readyState >= 1 && companionReady) {
            return true;
        }
        if (companionReady && Number.isFinite(state.networkState) && state.networkState > 0 && state.networkState < 3) {
            return true;
        }

        return false;
    }

    if (signal === 'bootstrap') {
        return companionReady && (readyState >= 2
            || state.hasDecodedFrames
            || state.hasVideoSize
            || (!(media.pmms && media.pmms.providerBackedStartup) && readyState >= 1 && state.duration > 0));
    }

    return false;
}

function isProviderBackedStartup(options, media) {
    var resolver = options && typeof options.resolver === 'object' ? options.resolver : {};
    var sourceUrl = String((options && (options.originalUrl || options.url)) || '').toLowerCase();

    if (media && media.youTubeApi) {
        return true;
    }

    if (media && media.externalYoutube) {
        return true;
    }

    if (media && media.twitchApi) {
        return true;
    }

    if (resolver.status === 'browser'
        || resolver.status === 'fallback'
        || resolver.instance === 'youtube_embed'
        || resolver.provider === 'embed'
        || resolver.provider === 'hosted_player'
        || resolver.provider === 'browser') {
        return true;
    }

    return sourceUrl.indexOf('youtube.com') !== -1
        || sourceUrl.indexOf('youtu.be') !== -1
        || sourceUrl.indexOf('invidio.us') !== -1
        || sourceUrl.indexOf('invidious') !== -1
        || sourceUrl.indexOf('piped.video') !== -1
        || sourceUrl.indexOf('/watch?v=') !== -1;
}

function isRecoverableReadFailureMessage(message) {
    var text = String(message || '').toLowerCase();
    return text.indexOf('pipeline_error_read') !== -1
        || text.indexOf('ffmpegdemuxer') !== -1
        || text.indexOf('data source error') !== -1
        || text.indexOf('mediaerrorcode=2') !== -1
        || text.indexOf('networkstate=3') !== -1
        || text.indexOf('net::') !== -1
        || text.indexOf('err_') !== -1
        || text.indexOf('failed to fetch') !== -1
        || text.indexOf('read failure') !== -1;
}

function isRecoverablePlaybackFailure(message, options, media) {
    if (!isRecoverableReadFailureMessage(message)) {
        return false;
    }
    return isProviderBackedStartup(options, media)
        || !!(media && media.pmms && media.pmms.providerBackedStartup);
}

function resolveStartupTimeoutMs(timeoutMs) {
    var numericTimeout = Number(timeoutMs);
    if (!Number.isFinite(numericTimeout) || numericTimeout <= 0) {
        numericTimeout = defaultStartupTimeoutMs;
    }

    return Math.max(5000, Math.min(30000, Math.round(numericTimeout)));
}

function clearStartupTracking(player) {
    if (!player || !player.pmms) {
        return;
    }

    resetStartupAttempt(player);
}

function resetVideoHealthState(player) {
    if (!player || !player.pmms || !player.pmms.videoHealth) {
        return;
    }

    player.pmms.videoHealth.lastTime = null;
    player.pmms.videoHealth.lastFrames = null;
    player.pmms.videoHealth.stalledSince = 0;
}

function stopVideoHealthMonitor(player) {
    if (!player || !player.pmms) {
        return;
    }

    if (player.pmms.videoHealthInterval) {
        clearInterval(player.pmms.videoHealthInterval);
        player.pmms.videoHealthInterval = null;
    }
}

function recoverVideoPlayback(player, reason) {
    if (!player || !player.pmms) {
        return false;
    }

    var health = player.pmms.videoHealth || {};
    health.recoveries = Number(health.recoveries) || 0;
    if (health.recoveries >= 2) {
        return false;
    }

    health.recoveries += 1;
    health.stalledSince = 0;
    player.pmms.videoHealth = health;

    debugLog('dui_browser', 'recovering stalled video frames', {
        attempt: health.recoveries,
        reason: reason || 'video_frame_stall',
        hls: !!player.hlsPlayer
    });

    try {
        if (player.hlsPlayer && typeof player.hlsPlayer.recoverMediaError === 'function') {
            player.hlsPlayer.recoverMediaError();
            if (typeof player.hlsPlayer.startLoad === 'function') {
                player.hlsPlayer.startLoad();
            }
            return true;
        }
    } catch (_) {}

    try {
        var node = getMediaElementNode(player) || player;
        if (node && typeof node.load === 'function' && node.currentSrc) {
            var currentTime = Number(node.currentTime) || 0;
            node.load();
            if (currentTime > 0) {
                try {
                    node.currentTime = currentTime;
                } catch (_) {}
            }
            try {
                node.play();
            } catch (_) {}
            return true;
        }
    } catch (_) {}

    return false;
}

function checkVideoHealth(player) {
    if (!player || !player.pmms || player.pmms.removed === true) {
        stopVideoHealthMonitor(player);
        return;
    }

    var options = player.pmms.latestOptions || {};
    var node = getMediaElementNode(player) || player;
    if (!node || !hasExpectedVideoTrack(player, options)) {
        resetVideoHealthState(player);
        return;
    }

    if (node.paused || node.ended || player.pmms.inRange !== true || Number(node.readyState) < 2) {
        resetVideoHealthState(player);
        return;
    }

    var decodedFrames = getDecodedFrameCount(node);
    if (!Number.isFinite(decodedFrames)) {
        return;
    }

    var currentTime = Number(node.currentTime);
    if (!Number.isFinite(currentTime)) {
        resetVideoHealthState(player);
        return;
    }

    var health = player.pmms.videoHealth || {};
    var lastTime = Number(health.lastTime);
    var lastFrames = Number(health.lastFrames);
    var now = getNowMs();

    if (!Number.isFinite(lastTime) || !Number.isFinite(lastFrames)) {
        health.lastTime = currentTime;
        health.lastFrames = decodedFrames;
        health.stalledSince = 0;
        player.pmms.videoHealth = health;
        return;
    }

    var timeAdvanced = currentTime - lastTime > 1.25;
    var framesAdvanced = decodedFrames > lastFrames;
    if (!timeAdvanced || framesAdvanced) {
        health.lastTime = currentTime;
        health.lastFrames = decodedFrames;
        health.stalledSince = 0;
        player.pmms.videoHealth = health;
        return;
    }

    health.stalledSince = health.stalledSince || now;
    health.lastTime = currentTime;
    health.lastFrames = decodedFrames;
    player.pmms.videoHealth = health;

    if ((now - health.stalledSince) < 9000) {
        return;
    }

    if (recoverVideoPlayback(player, 'decoded_frames_stalled')) {
        resetVideoHealthState(player);
        return;
    }

    if (typeof player.pmms.reportPlaybackFailure === 'function') {
        player.pmms.reportPlaybackFailure('Video frames stopped while audio kept playing.');
    }
}

function startVideoHealthMonitor(player, options) {
    if (!player || !player.pmms || (options && options.video === false)) {
        return;
    }

    player.pmms.latestOptions = options || player.pmms.latestOptions || {};
    if (!player.pmms.videoHealth) {
        player.pmms.videoHealth = {
            lastTime: null,
            lastFrames: null,
            stalledSince: 0,
            recoveries: 0
        };
    }

    if (player.pmms.videoHealthInterval) {
        return;
    }

    player.pmms.videoHealthInterval = setInterval(function() {
        checkVideoHealth(player);
    }, 2500);
}

function markStartupTracking(player, attemptId, playbackToken, startupTimeoutMs, handle, options) {
    ensurePlayerState(player);
    clearStartupWatchdog(player);
    player.pmms.playbackToken = playbackToken || player.pmms.playbackToken || null;
    player.pmms.startupAttemptId = attemptId || null;
    player.pmms.startupPlaybackToken = playbackToken || player.pmms.playbackToken || null;
    player.pmms.startupReadySent = false;
    player.pmms.awaitingActivation = !!attemptId;

    if (!attemptId) {
        return;
    }

    debugLog('dui_browser', 'tracking startup attempt', {
        handle: handle,
        attemptId: attemptId,
        playbackToken: playbackToken || null,
        url: redactUrlForDebug(options && options.url ? options.url : null),
        startupTimeoutMs: resolveStartupTimeoutMs(startupTimeoutMs)
    });

    var expectedAttemptId = player.pmms.startupAttemptId;
    var expectedPlaybackToken = player.pmms.startupPlaybackToken || null;
    var expectedUrl = options && options.url ? options.url : null;
    player.pmms.startupWatchdogId = setTimeout(function() {
        if (!player || !player.pmms || player.pmms.removed === true || player.isConnected === false) {
            return;
        }
        if (player.pmms.startupReadySent) {
            return;
        }
        if (String(player.pmms.startupAttemptId || '') !== String(expectedAttemptId || '')) {
            return;
        }
        if (String(player.pmms.startupPlaybackToken || '') !== String(expectedPlaybackToken || '')) {
            return;
        }

        if (canFinishStartupReady(player, 'poll')) {
            finishStartupAttempt(player, handle, 'ready', {
                attemptId: expectedAttemptId,
                playbackToken: expectedPlaybackToken,
                metadata: buildResolvedMetadata(player, options || player.pmms.latestOptions || {})
            });
            return;
        }

        notifyStartupError(handle, expectedAttemptId, expectedPlaybackToken, expectedUrl, appendMediaDiagnostics('Playback startup timed out.', player));
        removePlayer(player);
    }, resolveStartupTimeoutMs(startupTimeoutMs));
}

function notifyStartupReady(handle, attemptId, playbackToken, metadata) {
    if (!attemptId) {
        return;
    }

    debugLog('dui_browser', 'startup ready sent', {
        handle: handle,
        attemptId: attemptId,
        playbackToken: playbackToken || null,
        metadata: metadata || {}
    });
    sendMessage('pmmsDuiStartupReady', {
        handle: handle,
        attemptId: attemptId,
        playbackToken: playbackToken || null,
        metadata: metadata || {}
    });
}

function notifyStartupError(handle, attemptId, playbackToken, url, message) {
    if (!attemptId) {
        return;
    }

    debugLog('dui_browser', 'startup error sent', {
        handle: handle,
        attemptId: attemptId,
        playbackToken: playbackToken || null,
        url: redactUrlForDebug(url),
        message: message
    });
    sendMessage('pmmsDuiStartupError', {
        handle: handle,
        attemptId: attemptId,
        playbackToken: playbackToken || null,
        url: url,
        message: message
    });
}

function notifyLocalError(handle, url, message, playbackToken) {
    debugLog('dui_browser', 'local playback error sent', {
        handle: handle,
        playbackToken: playbackToken || null,
        url: redactUrlForDebug(url),
        message: message
    });
    sendMessage('pmmsDuiLocalError', {
        handle: handle,
        playbackToken: playbackToken || null,
        url: url,
        message: message
    });
}

function applyAudioFilter(player, config) {
    cleanupAudioGraph(player);

    var AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) {
        return false;
    }

    try {
        var mediaNode = getAudioPlaybackNode(player);
        if (!mediaNode) {
            return false;
        }

        var context = new AudioContextCtor();
        var source = context.createMediaElementSource(mediaNode);
        var splitter = context.createChannelSplitter(2);
        var merger = context.createChannelMerger(2);
        var gainNode = context.createGain();
        var lowpass = context.createBiquadFilter();
        var highpass = context.createBiquadFilter();

        gainNode.gain.value = 0.5;
        lowpass.type = 'lowpass';
        lowpass.frequency.value = config.lowpass;
        highpass.type = 'highpass';
        highpass.frequency.value = config.highpass;

        source.connect(splitter);
        splitter.connect(merger, 0, 0);
        splitter.connect(merger, 1, 0);
        splitter.connect(merger, 0, 1);
        splitter.connect(merger, 1, 1);
        merger.connect(gainNode);
        gainNode.connect(lowpass);
        lowpass.connect(highpass);
        highpass.connect(context.destination);

        player.pmms.audioGraph = {
            context: context,
            source: source,
            splitter: splitter,
            merger: merger,
            gainNode: gainNode,
            lowpass: lowpass,
            highpass: highpass
        };
        player.pmms.filterAdded = true;
        return true;
    } catch (_) {
        cleanupAudioGraph(player);
        return false;
    }
}

function applyRadioFilter(player) {
    return applyAudioFilter(player, {
        lowpass: 5000,
        highpass: 200
    });
}

function createAudioVisualization(player, visualization) {
    cleanupVisualization(player);

    var mediaNode = getAudioPlaybackNode(player);
    if (!mediaNode) {
        return false;
    }

    var waveCanvas = document.createElement('canvas');
    waveCanvas.id = player.id + '_visualization';
    waveCanvas.style.position = 'absolute';
    waveCanvas.style.top = '0';
    waveCanvas.style.left = '0';
    waveCanvas.style.width = '100%';
    waveCanvas.style.height = '100%';

    player.appendChild(waveCanvas);

    if (!mediaNode.id) {
        mediaNode.id = player.id + '_html5Player';
    }

    if (mediaNode.style) {
        mediaNode.style.visibility = 'hidden';
    }

    try {
        if (player.youTubeApi && typeof player.youTubeApi.getIframe === 'function') {
            var iframe = player.youTubeApi.getIframe();
            if (iframe && iframe.style) {
                iframe.style.visibility = 'hidden';
            }
        }
    } catch (_) {}

    var wave = new Wave();
    var options = visualization ? copyObject(audioVisualizations[visualization] || {}) : { type: 'cubes' };
    if (options.type === undefined) {
        options.type = visualization || 'cubes';
    }
    options.skipUserEventsWatcher = true;
    options.elementDoc = getPlayerDocument(player);

    try {
        wave.fromElement(mediaNode.id, waveCanvas.id, options);
        player.pmms.wave = wave;
        player.pmms.visualizationCanvasId = waveCanvas.id;
        player.pmms.visualizationElementId = mediaNode.id;
        player.pmms.visualizationAdded = true;
        return true;
    } catch (_) {
        cleanupVisualization(player);
        return false;
    }
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

    var relativePath = url.replace(/^\/+/, '');
    return 'http://' + currentServerEndpoint + '/' + resourceName + '/media/' + encodeURI(relativePath);
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
    if (numeric === 101 || numeric === 150) return 'Embedded YouTube playback is blocked by the video owner.';
    if (Number.isFinite(numeric)) return 'YouTube error ' + numeric + '.';
    return 'YouTube playback error.';
}

function getPlaybackErrorMessage(media, fallbackText) {
    var node = getMediaElementNode(media) || media;
    if (node && node.error) {
        if (node.error.message) {
            return node.error.message;
        }
        if (node.error.code !== undefined && node.error.code !== null) {
            return 'Media error code ' + node.error.code;
        }
    }
    return fallbackText;
}

function getMediaDiagnostics(media) {
    var node = getMediaElementNode(media) || media;
    if (!node) {
        return '';
    }

    var parts = [];
    if (media && media.externalYoutube) {
        try {
            var externalState = media.externalYoutube.state || {};
            parts.push('externalYoutubeMethod=' + String(externalState.method || 'external'));
            parts.push('externalYoutubePaused=' + (externalState.paused === true ? 1 : 0));
            if (Number.isFinite(Number(externalState.duration))) {
                parts.push('duration=' + Number(externalState.duration));
            }
        } catch (_) {}
    }
    if (media && media.youTubeApi) {
        try {
            if (typeof media.youTubeApi.getPlayerState === 'function') {
                parts.push('youtubeState=' + Number(media.youTubeApi.getPlayerState()));
            }
            if (typeof media.youTubeApi.getDuration === 'function') {
                parts.push('duration=' + (Number(media.youTubeApi.getDuration()) || 0));
            }
        } catch (_) {}
    }
    if (media && media.twitchApi) {
        try {
            if (typeof media.twitchApi.isPaused === 'function') {
                parts.push('twitchPaused=' + (media.twitchApi.isPaused() === true ? 1 : 0));
            }
            if (typeof media.twitchApi.getChannel === 'function') {
                parts.push('twitchChannel=' + String(media.twitchApi.getChannel() || ''));
            }
        } catch (_) {}
    }
    if (node.readyState !== undefined) {
        parts.push('readyState=' + node.readyState);
    }
    if (node.networkState !== undefined) {
        parts.push('networkState=' + node.networkState);
    }
    if (node.error) {
        if (node.error.code !== undefined && node.error.code !== null) {
            parts.push('mediaErrorCode=' + node.error.code);
        }
        if (node.error.message) {
            parts.push('mediaError=' + node.error.message);
        }
    }
    if (node.videoWidth !== undefined || node.videoHeight !== undefined) {
        parts.push('video=' + (Number(node.videoWidth) || 0) + 'x' + (Number(node.videoHeight) || 0));
    }
    var decodedFrames = getDecodedFrameCount(node);
    if (Number.isFinite(decodedFrames)) {
        parts.push('decodedFrames=' + decodedFrames);
    }
    if (media && media.hlsPlayer) {
        var hls = media.hlsPlayer;
        var levels = Array.isArray(hls.levels) ? hls.levels : [];
        if (levels.length) {
            var maxWidth = 0;
            var maxHeight = 0;
            levels.forEach(function(level) {
                maxWidth = Math.max(maxWidth, Number(level && level.width) || 0);
                maxHeight = Math.max(maxHeight, Number(level && level.height) || 0);
            });
            parts.push('hlsLevels=' + levels.length + '@' + maxWidth + 'x' + maxHeight);
        }
        if (Array.isArray(hls.audioTracks)) {
            parts.push('hlsAudioTracks=' + hls.audioTracks.length);
        }
        if (media.pmms && (media.pmms.hlsCompatibilityError || media.pmms.hlsCompatibilityWarning)) {
            parts.push('hlsCompatibility=' + String(media.pmms.hlsCompatibilityError || media.pmms.hlsCompatibilityWarning));
        }
        if (media.pmms && media.pmms.hlsCanvas) {
            parts.push('hlsCanvas=1');
        }
        if (media.pmms && media.pmms.hlsCanvasError) {
            parts.push('hlsCanvasError=' + String(media.pmms.hlsCanvasError));
        }
        if (media.pmms && media.pmms.lastHlsError) {
            parts.push('hlsError=' + String(media.pmms.lastHlsError.details || media.pmms.lastHlsError.type || 'unknown'));
        }
    }
    if (node.currentSrc) {
        try {
            var current = new URL(node.currentSrc);
            parts.push('host=' + current.host);
            parts.push('path=' + current.pathname);
        } catch (_) {}
    }
    var companionAudio = getCompanionAudioNode(media);
    if (companionAudio) {
        if (companionAudio.readyState !== undefined) {
            parts.push('audioReadyState=' + companionAudio.readyState);
        }
        if (companionAudio.networkState !== undefined) {
            parts.push('audioNetworkState=' + companionAudio.networkState);
        }
        if (companionAudio.error) {
            if (companionAudio.error.code !== undefined && companionAudio.error.code !== null) {
                parts.push('audioErrorCode=' + companionAudio.error.code);
            }
            if (companionAudio.error.message) {
                parts.push('audioError=' + companionAudio.error.message);
            }
        }
        if (companionAudio.currentSrc) {
            try {
                var audioCurrent = new URL(companionAudio.currentSrc);
                parts.push('audioHost=' + audioCurrent.host);
            } catch (_) {}
        }
    }
    return parts.length ? '[' + parts.join(' ') + ']' : '';
}

function appendMediaDiagnostics(message, media) {
    var diagnostics = getMediaDiagnostics(media);
    if (!diagnostics) {
        return message;
    }
    return String(message || 'Playback failed.') + ' ' + diagnostics;
}

function clamp01(value) {
    if (!Number.isFinite(Number(value))) return 0;
    return Math.max(0, Math.min(1, Number(value)));
}

function clampTransitionSeconds(value) {
    if (!Number.isFinite(Number(value))) return defaultTransitionSeconds;
    return Math.max(0, Math.min(maxTransitionSeconds, Number(value)));
}

function getEffectiveTransitionSeconds(source) {
    if (source && source.transitionState && source.transitionState.immediate === true) {
        return 0;
    }
    return clampTransitionSeconds(source && source.transitionSeconds);
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
        player.pmms.transitionSeconds = defaultTransitionSeconds;
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
    if (player.pmms.startupAttemptId === undefined) {
        player.pmms.startupAttemptId = null;
    }
    if (player.pmms.startupPlaybackToken === undefined) {
        player.pmms.startupPlaybackToken = null;
    }
    if (player.pmms.startupReadySent === undefined) {
        player.pmms.startupReadySent = false;
    }
    if (player.pmms.awaitingActivation === undefined) {
        player.pmms.awaitingActivation = false;
    }
    if (player.pmms.startupWatchdogId === undefined) {
        player.pmms.startupWatchdogId = null;
    }
    if (player.pmms.playbackToken === undefined) {
        player.pmms.playbackToken = null;
    }
    if (!Array.isArray(player.pmms.startupCleanupFns)) {
        player.pmms.startupCleanupFns = [];
    }
}

function getCanonicalPlayerId(handle) {
    return 'player_' + String(handle);
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
        clearStartupTracking(player);
        stopVideoHealthMonitor(player);
    }

    hideLoadingIcon();
    disposePlayerEnhancements(player);

    callMediaPlaybackMethod(player, 'pause');
    var companionAudio = getCompanionAudioNode(player);
    if (companionAudio) {
        try {
            companionAudio.pause();
        } catch (_) {}
        try {
            companionAudio.removeAttribute('src');
            if (typeof companionAudio.load === 'function') {
                companionAudio.load();
            }
        } catch (_) {}
        if (companionAudio.parentNode) {
            companionAudio.remove();
        }
        if (player.pmms) {
            player.pmms.audioCompanion = null;
        }
    }
    try {
        if (player.hlsPlayer && typeof player.hlsPlayer.destroy === 'function') {
            player.hlsPlayer.destroy();
        }
    } catch (_) {}
    try {
        if (player.externalYoutube) {
            if (typeof player.externalYoutube.post === 'function') {
                player.externalYoutube.post({ command: 'stop' });
            }
            if (player.externalYoutube.messageHandler) {
                window.removeEventListener('message', player.externalYoutube.messageHandler);
            }
            player.externalYoutube = null;
        }
    } catch (_) {}
    try {
        if (player.youTubeApi && typeof player.youTubeApi.destroy === 'function') {
            player.youTubeApi.destroy();
        }
    } catch (_) {}
    try {
        if (player.twitchApi) {
            if (typeof player.twitchApi.pause === 'function') {
                player.twitchApi.pause();
            }
            player.twitchApi = null;
        }
    } catch (_) {}
    try {
        if (player.renderer && typeof player.renderer.destroy === 'function') {
            player.renderer.destroy();
        }
    } catch (_) {}

    var noise = document.getElementById(player.id + '_noise');
    if (noise) {
        noise.remove();
    }

    if (player.parentNode) {
        player.remove();
    }

    if (!document.querySelector('[data-pmms-stale-handle]') && !document.querySelector('.pmms-recovering')) {
        document.body.classList.remove('pmms-recovering-source');
    }
}

function removeStalePlayersForHandle(handle) {
    var selector = '[data-pmms-stale-handle="' + String(handle).replace(/"/g, '\\"') + '"]';
    var stalePlayers = document.querySelectorAll(selector);
    stalePlayers.forEach(function(player) {
        removePlayer(player);
    });
    if (!document.querySelector('[data-pmms-stale-handle]')) {
        document.body.classList.remove('pmms-recovering-source');
    }
}

function parkStalePlayerForRecovery(player, handle) {
    if (!player || !player.parentNode || !player.pmms) {
        return false;
    }

    player.pmms.recovering = true;
    player.pmms.localRecoveryPending = true;
    player.pmms.staleRecovery = true;
    clearStartupTracking(player);
    stopVideoHealthMonitor(player);
    cleanupAudioGraph(player);

    try {
        setVolume(player, 0);
        callMediaPlaybackMethod(player, 'pause');
    } catch (_) {}

    var staleId = getCanonicalPlayerId(handle) + '_stale_' + String(Date.now());
    player.id = staleId;
    player.dataset.pmmsStaleHandle = String(handle);
    player.classList.add('pmms-stale-recovery');
    player.style.pointerEvents = 'none';
    document.body.classList.add('pmms-recovering-source');

    window.setTimeout(function() {
        if (player && player.parentNode && player.pmms && player.pmms.staleRecovery) {
            removePlayer(player);
            if (!document.querySelector('[data-pmms-stale-handle]')) {
                document.body.classList.remove('pmms-recovering-source');
            }
        }
    }, 20000);

    return true;
}

function getHlsLevelDetails(media) {
    if (!media || !media.hlsPlayer) {
        return null;
    }

    if (media.pmms && media.pmms.hlsLevelDetails) {
        return media.pmms.hlsLevelDetails;
    }

    var hls = media.hlsPlayer;
    if (hls.latestLevelDetails) {
        return hls.latestLevelDetails;
    }

    var levelIndex = Number.isFinite(Number(hls.currentLevel)) && Number(hls.currentLevel) >= 0
        ? Number(hls.currentLevel)
        : Number(hls.loadLevel);
    var level = hls.levels && hls.levels[levelIndex] ? hls.levels[levelIndex] : null;
    return level && level.details ? level.details : null;
}

function getHlsVodDuration(details) {
    if (!details || details.live === true) {
        return 0;
    }

    var total = Number(details.totalduration);
    if (Number.isFinite(total) && total > 0) {
        return total;
    }

    if (Array.isArray(details.fragments)) {
        return details.fragments.reduce(function(sum, fragment) {
            var duration = Number(fragment && fragment.duration);
            return sum + (Number.isFinite(duration) && duration > 0 ? duration : 0);
        }, 0);
    }

    return 0;
}

function buildResolvedMetadata(media, options) {
    var metadata = copyObject(options);
    var node = getMediaElementNode(media) || media;
    var hlsDetails = getHlsLevelDetails(media);
    var resolvedDuration = Number(node.duration);

    if ((!Number.isFinite(resolvedDuration) || resolvedDuration <= 0) && node.seekable && node.seekable.length > 0) {
        try {
            var seekableEnd = Number(node.seekable.end(node.seekable.length - 1));
            var seekableStart = Number(node.seekable.start(0)) || 0;
            if (Number.isFinite(seekableEnd) && seekableEnd > seekableStart) {
                resolvedDuration = seekableEnd - seekableStart;
            }
        } catch (_) {}
    }

    if ((!Number.isFinite(resolvedDuration) || resolvedDuration <= 0) && hlsDetails) {
        resolvedDuration = getHlsVodDuration(hlsDetails);
    }

    metadata.live = hlsDetails ? hlsDetails.live === true : metadata.live === true;
    if (Number.isFinite(resolvedDuration) && resolvedDuration > 0) {
        metadata.duration = resolvedDuration;
    } else {
        metadata.duration = false;
        metadata.loop = false;
    }

    if (media.externalYoutube) {
        var externalState = media.externalYoutube.state || {};
        if (externalState.title && (!metadata.title || metadata.title === metadata.url)) {
            metadata.title = externalState.title;
        }
        if (Number.isFinite(Number(externalState.duration)) && Number(externalState.duration) > 0) {
            metadata.duration = Number(externalState.duration);
        }
        metadata.live = externalState.live === true;
        if (!metadata.duration) {
            metadata.loop = false;
        }
        media.videoTracks = { length: 1 };
    } else if (media.youTubeApi) {
        var data = media.youTubeApi.getVideoData ? media.youTubeApi.getVideoData() : null;
        if (data && data.title) {
            metadata.title = data.title;
        }
        media.videoTracks = { length: 1 };
    } else if (media.twitchApi) {
        try {
            var channel = media.twitchApi.getChannel && media.twitchApi.getChannel();
            if (channel && !metadata.author) {
                metadata.author = channel;
            }
        } catch (_) {}
        metadata.live = true;
        metadata.duration = false;
        metadata.loop = false;
        media.videoTracks = { length: 1 };
    } else if (media.hlsPlayer) {
        media.videoTracks = media.hlsPlayer.videoTracks || { length: 0 };
    } else if (media.originalNode && media.originalNode.videoTracks) {
        media.videoTracks = media.originalNode.videoTracks;
    } else {
        media.videoTracks = { length: 0 };
    }

    metadata.audioTracks = getAvailableAudioTracks(media);
    metadata.audioTrack = getSelectedAudioTrack(media);
    metadata.selectedAudioTrack = metadata.audioTrack;

    return metadata;
}

function notifyPlaybackMetadata(handle, playbackToken, metadata) {
    if (handle === undefined || handle === null || !metadata) {
        return;
    }

    debugLog('dui_browser', 'playback metadata sent', {
        handle: handle,
        playbackToken: playbackToken || null,
        duration: metadata.duration,
        live: metadata.live === true,
        audioTrackCount: Array.isArray(metadata.audioTracks) ? metadata.audioTracks.length : 0
    });
    sendMessage('pmmsDuiMetadata', {
        handle: handle,
        playbackToken: playbackToken || null,
        metadata: metadata
    });
}

function isPlaybackEndCredible(metadata, state) {
    var durationSource = metadata && metadata.duration !== undefined && metadata.duration !== null
        ? metadata.duration
        : state && state.duration;
    var duration = Number(durationSource);
    if (Number.isNaN(duration)) {
        return true;
    }
    if (!Number.isFinite(duration) || duration <= 0) {
        return false;
    }

    var currentTime = Number(metadata && metadata.currentTime !== undefined ? metadata.currentTime : state && state.currentTime);
    if (!Number.isFinite(currentTime)) {
        return false;
    }

    return (duration - currentTime) < 3;
}

function notifyPlaybackEnded(media, options, reason) {
    if (!media || !media.pmms || media.pmms.endedSent === true) {
        return false;
    }

    var metadata = buildResolvedMetadata(media, options || {});
    var state = getPlaybackNodeState(media);
    metadata.currentTime = state.currentTime;
    if (!metadata.duration && state.duration > 0) {
        metadata.duration = state.duration;
    }
    metadata.endedReason = reason || 'ended';
    if (!isPlaybackEndCredible(metadata, state)) {
        debugLog('dui_browser', 'playback ended ignored before server callback', {
            currentTime: metadata.currentTime,
            duration: metadata.duration,
            reason: metadata.endedReason
        });
        return false;
    }

    media.pmms.endedSent = true;
    var handle = options && options.handle !== undefined ? options.handle : media.dataset && media.dataset.handle;
    var playbackToken = media.pmms.playbackToken || media.pmms.startupPlaybackToken || (options && options.playbackToken) || null;
    debugLog('dui_browser', 'playback ended sent', {
        handle: handle,
        playbackToken: playbackToken,
        currentTime: metadata.currentTime,
        duration: metadata.duration,
        reason: metadata.endedReason
    });
    sendMessage('pmmsDuiEnded', {
        handle: handle,
        playbackToken: playbackToken,
        metadata: metadata
    });
    return true;
}

function schedulePlaybackMetadataUpdate(media, options, reason) {
    if (!media || !media.pmms || media.pmms.removed === true) {
        return;
    }

    if (media.pmms.metadataUpdateTimer) {
        clearTimeout(media.pmms.metadataUpdateTimer);
    }

    media.pmms.metadataUpdateReason = reason || media.pmms.metadataUpdateReason || 'metadata';
    media.pmms.metadataUpdateTimer = setTimeout(function() {
        if (!media || !media.pmms || media.pmms.removed === true) {
            return;
        }
        media.pmms.metadataUpdateTimer = null;
        var metadata = buildResolvedMetadata(media, options || {});
        metadata.metadataReason = media.pmms.metadataUpdateReason || reason || 'metadata';
        media.pmms.metadataUpdateReason = null;
        notifyPlaybackMetadata(
            options && options.handle !== undefined ? options.handle : media.dataset && media.dataset.handle,
            media.pmms.playbackToken || media.pmms.startupPlaybackToken || (options && options.playbackToken) || null,
            metadata
        );
    }, 120);
}

function buildExternalYoutubePlayerUrl(videoId, options) {
    var config = youtubeExternalPlayerConfig || {};
    if (!config.externalPlayerUrl) {
        return null;
    }

    try {
        var url = new URL(config.externalPlayerUrl, window.location.href);
        url.searchParams.set('videoId', videoId);
        url.searchParams.set('v', videoId);
        url.searchParams.set('autoplay', '1');
        url.searchParams.set('muted', '1');
        url.searchParams.set('start', String(Math.max(0, Math.floor(getYouTubeStartSeconds(options)))));
        url.searchParams.set('origin', window.location && window.location.origin && window.location.origin !== 'null'
            ? window.location.origin
            : ('http://' + currentServerEndpoint));
        url.searchParams.set('allowFrontendFallback', config.allowFrontendFallback ? '1' : '0');
        url.searchParams.set('frontendTimeoutMs', String(config.frontendFallbackTimeoutMs || 6000));
        if (Array.isArray(config.frontendInstances) && config.frontendInstances.length) {
            url.searchParams.set('frontends', JSON.stringify(config.frontendInstances));
        }
        return url.toString();
    } catch (_) {
        return null;
    }
}

function initExternalYouTubePlayer(id, handle, options, startupAttemptId, playbackToken, startupTimeoutMs) {
    options.handle = handle;
    var videoId = extractYouTubeVideoId(options.originalUrl || options.url || '');
    var externalUrl = buildExternalYoutubePlayerUrl(videoId, options);
    var player = document.createElement('div');
    player.id = id;
    player.className = 'player pmms-youtube-external';
    player.dataset.handle = String(handle);
    player.pmms = {
        initialized: false,
        attenuationFactor: options.attenuation && Number.isFinite(Number(options.attenuation.diffRoom))
            ? Number(options.attenuation.diffRoom)
            : 0,
        volumeFactor: Number.isFinite(Number(options.diffRoomVolume)) ? Number(options.diffRoomVolume) : 1.0,
        currentUrl: options.url,
        transitionSeconds: getEffectiveTransitionSeconds(options),
        fadeInStartedAt: 0,
        fadeInEndsAt: 0,
        inRange: true,
        lastDistance: -1,
        lastDistanceAt: 0,
        playbackToken: playbackToken || options.playbackToken || null,
        startupAttemptId: startupAttemptId || null,
        startupPlaybackToken: startupAttemptId ? (playbackToken || options.playbackToken || null) : null,
        startupReadySent: false,
        awaitingActivation: !!startupAttemptId,
        startupWatchdogId: null,
        providerBackedStartup: true,
        latestOptions: options
    };

    var iframe = document.createElement('iframe');
    iframe.className = 'pmms-youtube-external-frame';
    iframe.setAttribute('allow', 'autoplay; encrypted-media; fullscreen; picture-in-picture');
    iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    iframe.setAttribute('frameborder', '0');
    iframe.src = externalUrl || 'about:blank';
    player.appendChild(iframe);
    document.body.appendChild(player);

    var targetOrigin = '*';
    try {
        targetOrigin = new URL(externalUrl).origin;
    } catch (_) {}

    player.externalYoutube = {
        iframe: iframe,
        state: {
            currentTime: getYouTubeStartSeconds(options),
            duration: Number(options.duration) || 0,
            paused: true,
            method: 'external'
        },
        post: function(payload) {
            if (!iframe.contentWindow) {
                return;
            }
            iframe.contentWindow.postMessage({
                type: 'pmms-youtube-control',
                payload: payload || {}
            }, targetOrigin);
        },
        messageHandler: null
    };

    if (startupAttemptId) {
        markStartupTracking(player, startupAttemptId, playbackToken || options.playbackToken || null, startupTimeoutMs || options.startupTimeoutMs, handle, options);
    }

    var fail = function(message, code) {
        hideLoadingIcon();
        var finalMessage = message || describeYouTubeError(code);
        var diagnosticMessage = appendMediaDiagnostics(finalMessage, player);
        if (player.pmms.startupAttemptId && !player.pmms.startupReadySent) {
            finishStartupAttempt(player, handle, 'error', {
                attemptId: player.pmms.startupAttemptId,
                playbackToken: player.pmms.startupPlaybackToken || player.pmms.playbackToken,
                url: options.url,
                message: diagnosticMessage
            });
        } else {
            notifyLocalError(handle, options.url, diagnosticMessage, player.pmms.playbackToken);
        }
        removePlayer(player);
    };
    player.pmms.reportPlaybackFailure = fail;

    var complete = function(signal) {
        if (player.pmms.initialized) {
            return false;
        }
        if (!canFinishStartupReady(player, signal || 'external_youtube_playing')) {
            return false;
        }

        hideLoadingIcon();
        player.pmms.initialized = true;
        var metadata = buildResolvedMetadata(player, options);

        if (player.pmms.startupAttemptId) {
            return finishStartupAttempt(player, handle, 'ready', {
                attemptId: player.pmms.startupAttemptId,
                playbackToken: player.pmms.startupPlaybackToken || player.pmms.playbackToken,
                metadata: metadata
            });
        }

        if (player.pmms.transitionSeconds > 0) {
            var fadeNow = getNowMs();
            player.pmms.fadeInStartedAt = fadeNow;
            player.pmms.fadeInEndsAt = fadeNow + (player.pmms.transitionSeconds * 1000);
        }

        callMediaPlaybackMethod(player, 'play');
        return true;
    };

    player.externalYoutube.messageHandler = function(event) {
        if (event.source !== iframe.contentWindow) {
            return;
        }
        var data = event.data || {};
        if (!data || data.type !== 'pmms-youtube-event') {
            return;
        }

        var payload = data.payload || {};
        if (payload.state && typeof payload.state === 'object') {
            player.externalYoutube.state = Object.assign({}, player.externalYoutube.state || {}, payload.state);
        }

        if (data.event === 'debug') {
            debugLog('dui_browser', 'external YouTube player debug', payload);
            return;
        }

        if (data.event === 'ready') {
            player.pmms.externalYoutubeReady = true;
            schedulePlaybackMetadataUpdate(player, options, 'external_youtube_ready');
            if (options.paused === true) {
                complete('external_youtube_paused');
            }
            return;
        }

        if (data.event === 'playing') {
            player.pmms.externalYoutubeReady = true;
            if (player.externalYoutube.state) {
                player.externalYoutube.state.paused = false;
            }
            schedulePlaybackMetadataUpdate(player, options, 'external_youtube_playing');
            complete('external_youtube_playing');
            return;
        }

        if (data.event === 'paused') {
            if (player.externalYoutube.state) {
                player.externalYoutube.state.paused = true;
            }
            schedulePlaybackMetadataUpdate(player, options, 'external_youtube_paused');
            return;
        }

        if (data.event === 'ended') {
            notifyPlaybackEnded(player, options, 'external_youtube_ended');
            return;
        }

        if (data.event === 'metadata') {
            schedulePlaybackMetadataUpdate(player, options, 'external_youtube_metadata');
            return;
        }

        if (data.event === 'error') {
            fail(payload.message || describeYouTubeError(payload.code), payload.code);
        }
    };
    window.addEventListener('message', player.externalYoutube.messageHandler);
    setTimeout(function() {
        if (!player.pmms.initialized) {
            player.pmms.externalYoutubeReady = true;
            if (player.externalYoutube.state) {
                player.externalYoutube.state.paused = false;
            }
            schedulePlaybackMetadataUpdate(player, options, 'external_youtube_playing');
            complete('external_youtube_playing');
        }
    }, 1500);

    iframe.addEventListener('load', function() {
        player.externalYoutube.post({
            command: 'load',
            videoId: videoId,
            start: getYouTubeStartSeconds(options),
            paused: options.paused === true
        });
    });

    if (!externalUrl || !videoId) {
        fail(!videoId ? 'Could not parse YouTube video id.' : 'External YouTube player URL is not configured.');
    }

    return player;
}

function initYouTubeEmbedPlayer(id, handle, options, startupAttemptId, playbackToken, startupTimeoutMs) {
    options.handle = handle;
    var videoId = extractYouTubeVideoId(options.originalUrl || options.url || '');
    var player = document.createElement('div');
    player.id = id;
    player.className = 'player pmms-youtube-embed';
    player.dataset.handle = String(handle);
    player.pmms = {
        initialized: false,
        attenuationFactor: options.attenuation && Number.isFinite(Number(options.attenuation.diffRoom))
            ? Number(options.attenuation.diffRoom)
            : 0,
        volumeFactor: Number.isFinite(Number(options.diffRoomVolume)) ? Number(options.diffRoomVolume) : 1.0,
        currentUrl: options.url,
        transitionSeconds: getEffectiveTransitionSeconds(options),
        fadeInStartedAt: 0,
        fadeInEndsAt: 0,
        inRange: true,
        lastDistance: -1,
        lastDistanceAt: 0,
        playbackToken: playbackToken || options.playbackToken || null,
        startupAttemptId: startupAttemptId || null,
        startupPlaybackToken: startupAttemptId ? (playbackToken || options.playbackToken || null) : null,
        startupReadySent: false,
        awaitingActivation: !!startupAttemptId,
        startupWatchdogId: null,
        providerBackedStartup: true,
        latestOptions: options
    };

    var target = document.createElement('div');
    target.id = id + '_youtube_target';
    target.className = 'pmms-youtube-target';
    player.appendChild(target);
    document.body.appendChild(player);
    if (startupAttemptId) {
        markStartupTracking(player, startupAttemptId, playbackToken || options.playbackToken || null, startupTimeoutMs || options.startupTimeoutMs, handle, options);
    }

    var youtubeHosts = ['https://www.youtube-nocookie.com', 'https://www.youtube.com'];
    var youtubeHostIndex = 0;
    var createYoutubePlayer = null;
    var externalFallbackUsed = false;
    var canRetryYoutubeError = function(code) {
        var numeric = Number(code);
        if (numeric === 2 || numeric === 100 || numeric === 101 || numeric === 150) {
            return false;
        }
        return youtubeHostIndex < youtubeHosts.length - 1 && typeof createYoutubePlayer === 'function';
    };
    var canFallbackToExternalYoutube = function(code) {
        var numeric = Number(code);
        if (numeric === 2 || numeric === 100 || numeric === 101 || numeric === 150) {
            return false;
        }
        return !externalFallbackUsed && canUseExternalYoutubePlayer();
    };

    var fail = function(message, code) {
        if (canRetryYoutubeError(code)) {
            youtubeHostIndex += 1;
            debugLog('dui_browser', 'retrying YouTube embed host', {
                handle: handle,
                code: Number(code),
                host: youtubeHosts[youtubeHostIndex]
            });
            try {
                if (player.youTubeApi && typeof player.youTubeApi.destroy === 'function') {
                    player.youTubeApi.destroy();
                }
            } catch (_) {}
            player.youTubeApi = null;
            target.innerHTML = '';
            createYoutubePlayer();
            return;
        }

        if (canFallbackToExternalYoutube(code)) {
            externalFallbackUsed = true;
            debugLog('dui_browser', 'falling back to external YouTube player', {
                handle: handle,
                code: Number(code),
                externalPlayerUrl: redactUrlForDebug(youtubeExternalPlayerConfig.externalPlayerUrl)
            });
            removePlayer(player);
            initExternalYouTubePlayer(id, handle, options, startupAttemptId, playbackToken, startupTimeoutMs);
            return;
        }

        hideLoadingIcon();
        var diagnosticMessage = appendMediaDiagnostics(message, player);
        if (player.pmms.startupAttemptId && !player.pmms.startupReadySent) {
            finishStartupAttempt(player, handle, 'error', {
                attemptId: player.pmms.startupAttemptId,
                playbackToken: player.pmms.startupPlaybackToken || player.pmms.playbackToken,
                url: options.url,
                message: diagnosticMessage
            });
        } else {
            notifyLocalError(handle, options.url, diagnosticMessage, player.pmms.playbackToken);
        }
        removePlayer(player);
    };
    player.pmms.reportPlaybackFailure = fail;

    var hardenIframe = function() {
        try {
            if (!player.youTubeApi || typeof player.youTubeApi.getIframe !== 'function') {
                return;
            }
            var iframe = player.youTubeApi.getIframe();
            if (!iframe) {
                return;
            }
            iframe.setAttribute('allow', 'autoplay; encrypted-media; fullscreen; picture-in-picture');
            iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
        } catch (_) {}
    };

    var complete = function(signal) {
        if (player.pmms.initialized) {
            return false;
        }
        if (!canFinishStartupReady(player, signal || 'youtube_ready')) {
            return false;
        }

        hideLoadingIcon();
        player.pmms.initialized = true;
        player.pmms.youtubeReady = true;
        var metadata = buildResolvedMetadata(player, options);
        var initialOffset = getYouTubeStartSeconds(options);
        if (initialOffset > 0) {
            setMediaCurrentTime(player, initialOffset);
        }

        if (player.pmms.startupAttemptId) {
            return finishStartupAttempt(player, handle, 'ready', {
                attemptId: player.pmms.startupAttemptId,
                playbackToken: player.pmms.startupPlaybackToken || player.pmms.playbackToken,
                metadata: metadata
            });
        }

        if (player.pmms.transitionSeconds > 0) {
            var fadeNow = getNowMs();
            player.pmms.fadeInStartedAt = fadeNow;
            player.pmms.fadeInEndsAt = fadeNow + (player.pmms.transitionSeconds * 1000);
        }

        callMediaPlaybackMethod(player, 'play');
        return true;
    };

    loadYouTubeIframeApi(function(error) {
        if (error) {
            fail(error.message || 'Could not load the YouTube IFrame API.');
            return;
        }
        if (!window.YT || typeof window.YT.Player !== 'function') {
            fail('YouTube IFrame API did not expose YT.Player.');
            return;
        }

        createYoutubePlayer = function() {
            try {
            var playerVars = {
                autoplay: 1,
                controls: 0,
                disablekb: 1,
                enablejsapi: 1,
                fs: 0,
                iv_load_policy: 3,
                playsinline: 1,
                rel: 0,
                start: getYouTubeStartSeconds(options)
            };
            if (window.location && window.location.origin && window.location.origin !== 'null') {
                playerVars.origin = window.location.origin;
                playerVars.widget_referrer = window.location.origin;
            }

            player.youTubeApi = new window.YT.Player(target.id, {
                host: youtubeHosts[youtubeHostIndex],
                videoId: videoId,
                width: '100%',
                height: '100%',
                playerVars: playerVars,
                events: {
                    onReady: function(event) {
                        player.pmms.youtubeReady = true;
                        hardenIframe();
                        try {
                            event.target.setVolume(0);
                            event.target.mute();
                            event.target.playVideo();
                        } catch (_) {}
                        schedulePlaybackMetadataUpdate(player, options, 'youtube_ready');
                    },
                    onStateChange: function(event) {
                        var state = Number(event && event.data);
                        if (state === 1 || (state === 2 && options.paused === true)) {
                            player.pmms.youtubeReady = true;
                            hardenIframe();
                            schedulePlaybackMetadataUpdate(player, options, 'youtube_state');
                            complete(state === 1 ? 'youtube_playing' : 'youtube_paused');
                        } else if (state === 3 || state === 5) {
                            player.pmms.youtubeReady = true;
                            hardenIframe();
                            schedulePlaybackMetadataUpdate(player, options, 'youtube_buffering');
                        }
                        if (state === 0) {
                            notifyPlaybackEnded(player, options, 'youtube_ended');
                        }
                    },
                    onError: function(event) {
                        fail(describeYouTubeError(event && event.data), event && event.data);
                    },
                    onAutoplayBlocked: function() {
                        fail('YouTube browser autoplay was blocked by Chromium.');
                    }
                }
            });
        } catch (err) {
            fail((err && err.message) || 'Could not create the YouTube IFrame player.');
        }
        };

        createYoutubePlayer();
    });

    return player;
}

function getTwitchParentHosts() {
    var seen = {};
    var hosts = [];
    function add(value) {
        if (!value) return;
        var host = String(value).split('/')[0].split(':')[0].trim().toLowerCase();
        if (!host || seen[host]) return;
        seen[host] = true;
        hosts.push(host);
    }

    try { add(window.location.hostname); } catch (_) {}
    try { add(new URL('http://' + currentServerEndpoint).hostname); } catch (_) {}
    add('localhost');
    add('127.0.0.1');
    return hosts.length ? hosts : ['localhost'];
}

function initTwitchEmbedPlayer(id, handle, options, startupAttemptId, playbackToken, startupTimeoutMs) {
    options.handle = handle;
    var twitchSource = parseTwitchPlayback(options.originalUrl || options.url || '');
    var player = document.createElement('div');
    player.id = id;
    player.className = 'player pmms-twitch-embed';
    player.dataset.handle = String(handle);
    player.pmms = {
        initialized: false,
        attenuationFactor: options.attenuation && Number.isFinite(Number(options.attenuation.diffRoom))
            ? Number(options.attenuation.diffRoom)
            : 0,
        volumeFactor: Number.isFinite(Number(options.diffRoomVolume)) ? Number(options.diffRoomVolume) : 1.0,
        currentUrl: options.url,
        transitionSeconds: getEffectiveTransitionSeconds(options),
        fadeInStartedAt: 0,
        fadeInEndsAt: 0,
        inRange: true,
        lastDistance: -1,
        lastDistanceAt: 0,
        playbackToken: playbackToken || options.playbackToken || null,
        startupAttemptId: startupAttemptId || null,
        startupPlaybackToken: startupAttemptId ? (playbackToken || options.playbackToken || null) : null,
        startupReadySent: false,
        awaitingActivation: !!startupAttemptId,
        startupWatchdogId: null,
        providerBackedStartup: true,
        latestOptions: options
    };

    var target = document.createElement('div');
    target.id = id + '_twitch_target';
    target.className = 'pmms-twitch-target';
    player.appendChild(target);
    document.body.appendChild(player);
    if (startupAttemptId) {
        markStartupTracking(player, startupAttemptId, playbackToken || options.playbackToken || null, startupTimeoutMs || options.startupTimeoutMs, handle, options);
    }

    var fail = function(message) {
        hideLoadingIcon();
        var diagnosticMessage = appendMediaDiagnostics(message, player);
        if (player.pmms.startupAttemptId && !player.pmms.startupReadySent) {
            finishStartupAttempt(player, handle, 'error', {
                attemptId: player.pmms.startupAttemptId,
                playbackToken: player.pmms.startupPlaybackToken || player.pmms.playbackToken,
                url: options.url,
                message: diagnosticMessage
            });
        } else {
            notifyLocalError(handle, options.url, diagnosticMessage, player.pmms.playbackToken);
        }
        removePlayer(player);
    };
    player.pmms.reportPlaybackFailure = fail;

    var complete = function(signal) {
        if (player.pmms.initialized) {
            return false;
        }
        if (!canFinishStartupReady(player, signal || 'twitch_ready')) {
            return false;
        }

        hideLoadingIcon();
        player.pmms.initialized = true;
        player.pmms.twitchReady = true;
        var metadata = buildResolvedMetadata(player, options);

        if (player.pmms.startupAttemptId) {
            return finishStartupAttempt(player, handle, 'ready', {
                attemptId: player.pmms.startupAttemptId,
                playbackToken: player.pmms.startupPlaybackToken || player.pmms.playbackToken,
                metadata: metadata
            });
        }

        if (player.pmms.transitionSeconds > 0) {
            var fadeNow = getNowMs();
            player.pmms.fadeInStartedAt = fadeNow;
            player.pmms.fadeInEndsAt = fadeNow + (player.pmms.transitionSeconds * 1000);
        }

        callMediaPlaybackMethod(player, 'play');
        return true;
    };

    if (!twitchSource) {
        fail('Could not parse Twitch channel or video URL.');
        return player;
    }

    loadTwitchEmbedApi(function(error) {
        if (error) {
            fail(error.message || 'Could not load the Twitch embed API.');
            return;
        }
        if (!window.Twitch || typeof window.Twitch.Player !== 'function') {
            fail('Twitch embed API did not expose Twitch.Player.');
            return;
        }

        try {
            var params = {
                width: '100%',
                height: '100%',
                autoplay: true,
                muted: true,
                parent: getTwitchParentHosts()
            };
            if (twitchSource.type === 'video') {
                params.video = twitchSource.video;
            } else {
                params.channel = twitchSource.channel;
            }

            var twitchPlayer = new window.Twitch.Player(target.id, params);
            player.twitchApi = twitchPlayer;

            function addTwitchListener(eventName, handler) {
                if (!eventName || typeof twitchPlayer.addEventListener !== 'function') {
                    return;
                }
                try {
                    twitchPlayer.addEventListener(eventName, handler);
                } catch (_) {}
            }

            addTwitchListener(window.Twitch.Player.READY, function() {
                player.pmms.twitchReady = true;
                try {
                    twitchPlayer.setMuted(true);
                    twitchPlayer.setVolume(0);
                    twitchPlayer.play();
                } catch (_) {}
                schedulePlaybackMetadataUpdate(player, options, 'twitch_ready');
            });
            addTwitchListener(window.Twitch.Player.PLAY, function() {
                player.pmms.twitchReady = true;
                schedulePlaybackMetadataUpdate(player, options, 'twitch_play');
                complete('twitch_playing');
            });
            addTwitchListener(window.Twitch.Player.PAUSE, function() {
                schedulePlaybackMetadataUpdate(player, options, 'twitch_pause');
            });
            addTwitchListener(window.Twitch.Player.ENDED, function() {
                notifyPlaybackEnded(player, options, 'twitch_ended');
            });
            addTwitchListener(window.Twitch.Player.OFFLINE, function() {
                fail('Twitch stream is offline or unavailable.');
            });
        } catch (err) {
            fail((err && err.message) || 'Could not create the Twitch embed player.');
        }
    });

    return player;
}

function initPlayer(id, handle, options, startupAttemptId, playbackToken, startupTimeoutMs) {
    options.handle = handle;
    if (isYoutubeEmbedPlayback(options)) {
        if (canUseExternalYoutubePlayer() && youtubeExternalPlayerConfig.preferExternalPlayer === true) {
            return initExternalYouTubePlayer(id, handle, options, startupAttemptId, playbackToken, startupTimeoutMs);
        }
        return initYouTubeEmbedPlayer(id, handle, options, startupAttemptId, playbackToken, startupTimeoutMs);
    }
    if (isTwitchPlayback(options)) {
        return initTwitchEmbedPlayer(id, handle, options, startupAttemptId, playbackToken, startupTimeoutMs);
    }

    var player = document.createElement('video');
    player.id = id;
    var hlsManagedPlayback = isHlsPlayback(options) && canUseHlsJs();
    if (!hlsManagedPlayback) {
        player.src = getPlaybackSourceUrl(options);
    } else {
        player.dataset.pmmsHls = '1';
    }
    player.dataset.handle = String(handle);

    player.pmms = {
        initialized: false,
        attenuationFactor: options.attenuation && Number.isFinite(Number(options.attenuation.diffRoom))
            ? Number(options.attenuation.diffRoom)
            : 0,
        volumeFactor: Number.isFinite(Number(options.diffRoomVolume)) ? Number(options.diffRoomVolume) : 1.0,
        currentUrl: options.url,
        transitionSeconds: getEffectiveTransitionSeconds(options),
        fadeInStartedAt: 0,
        fadeInEndsAt: 0,
        inRange: true,
        lastDistance: -1,
        lastDistanceAt: 0,
        playbackToken: playbackToken || options.playbackToken || null,
        startupAttemptId: startupAttemptId || null,
        startupPlaybackToken: startupAttemptId ? (playbackToken || options.playbackToken || null) : null,
        startupReadySent: false,
        awaitingActivation: !!startupAttemptId,
        startupWatchdogId: null
    };

    document.body.appendChild(player);
    if (startupAttemptId) {
        markStartupTracking(player, startupAttemptId, playbackToken || options.playbackToken || null, startupTimeoutMs || options.startupTimeoutMs, handle, options);
    }

    if (options.attenuation == null) {
        options.attenuation = { sameRoom: 0, diffRoom: 0 };
    }

    new MediaElement(id, {
        youtube: {
            nocookie: true
        },
        error: function (media) {
            var message = appendMediaDiagnostics(getPlaybackErrorMessage(media, 'Unknown init error'), media || player);
            hideLoadingIcon();

            if (startupAttemptId) {
                finishStartupAttempt(
                    media || player,
                    handle,
                    'error',
                    {
                        attemptId: startupAttemptId,
                        playbackToken: playbackToken || options.playbackToken || null,
                        url: options.url,
                        message: message
                    }
                );
            } else {
                notifyLocalError(handle, options.url, message, playbackToken || options.playbackToken || null);
            }

            removePlayer(media || player);
        },
        success: function (media) {
            media.className = 'player';

            media.pmms = media.pmms || {};
            media.pmms.initialized = false;
            media.pmms.attenuationFactor = options.attenuation.diffRoom;
            media.pmms.volumeFactor = options.diffRoomVolume || 1.0;
            media.pmms.currentUrl = options.url;
            media.pmms.transitionSeconds = getEffectiveTransitionSeconds(options);
            media.pmms.inRange = true;
            media.pmms.lastDistance = -1;
            media.pmms.lastDistanceAt = 0;
            media.pmms.fadeInStartedAt = 0;
            media.pmms.fadeInEndsAt = 0;
            media.pmms.playbackToken = playbackToken || options.playbackToken || media.pmms.playbackToken || null;
            media.pmms.startupAttemptId = startupAttemptId || null;
            media.pmms.startupPlaybackToken = startupAttemptId ? (media.pmms.playbackToken || null) : null;
            media.pmms.startupReadySent = false;
            media.pmms.awaitingActivation = !!startupAttemptId;
            media.pmms.startupWatchdogId = media.pmms.startupWatchdogId || null;
            media.pmms.providerBackedStartup = isProviderBackedStartup(options, media);
            if (startupAttemptId) {
                markStartupTracking(media, startupAttemptId, media.pmms.playbackToken, startupTimeoutMs || options.startupTimeoutMs, handle, options);
            }

            media.volume = 0;
            setMediaDisplay(media, options.video !== false);

            var reportPlaybackFailure = function(message) {
                hideLoadingIcon();
                var diagnosticMessage = appendMediaDiagnostics(message, media);
                var recoverable = isRecoverablePlaybackFailure(diagnosticMessage, options, media);

                if (media.pmms.startupAttemptId && !media.pmms.startupReadySent) {
                    if (!finishStartupAttempt(
                        media,
                        handle,
                        'error',
                        {
                            attemptId: media.pmms.startupAttemptId,
                            playbackToken: media.pmms.startupPlaybackToken || media.pmms.playbackToken,
                            url: options.url,
                            message: diagnosticMessage
                        }
                    )) {
                        return;
                    }
                } else {
                    if (recoverable) {
                        media.pmms.recovering = true;
                        media.pmms.localRecoveryPending = true;
                        media.classList.add('pmms-recovering');
                        document.body.classList.add('pmms-recovering-source');
                        showLoadingIcon();
                        debugLog('dui_browser', 'recoverable local playback error reported without teardown', {
                            handle: handle,
                            url: redactUrlForDebug(options.url),
                            message: diagnosticMessage
                        });
                        return;
                    }
                    notifyLocalError(handle, options.url, diagnosticMessage, media.pmms.playbackToken);
                }

                removePlayer(media);
            };

            media.pmms.reportPlaybackFailure = reportPlaybackFailure;
            media.pmms.latestOptions = options;
            startVideoHealthMonitor(media, options);

            if (media.youTubeApi && typeof media.youTubeApi.addEventListener === 'function') {
                media.youTubeApi.addEventListener('onError', function (event) {
                    reportPlaybackFailure(describeYouTubeError(event && event.data));
                });
            }

            var reportNodePlaybackError = function () {
                reportPlaybackFailure(getPlaybackErrorMessage(media, 'Unknown playback error'));
            };

            media.addEventListener('error', reportNodePlaybackError);
            var initialMediaNode = getMediaElementNode(media);
            if (initialMediaNode && initialMediaNode !== media && typeof initialMediaNode.addEventListener === 'function') {
                initialMediaNode.addEventListener('error', reportNodePlaybackError);
            }

            var completeMediaInitialization = function(signal) {
                if (media.pmms.initialized) {
                    return false;
                }

                var state = getPlaybackNodeState(media);
                debugLog('dui_browser', 'startup media signal', {
                    handle: handle,
                    attemptId: media.pmms.startupAttemptId || null,
                    signal: signal,
                    readyState: state.readyState,
                    networkState: state.networkState,
                    videoWidth: state.videoWidth,
                    videoHeight: state.videoHeight,
                    decodedFrames: state.decodedFrames
                });

                if (!canFinishStartupReady(media, signal)) {
                    return false;
                }

                hideLoadingIcon();

                var metadata = buildResolvedMetadata(media, options);
                var initialOffset = Number(options.offset);
                if (Number.isFinite(initialOffset) && initialOffset > 0 && Number(metadata.duration) > 0) {
                    setMediaCurrentTime(media, initialOffset % Number(metadata.duration));
                }
                media.pmms.initialized = true;

                if (media.pmms.startupAttemptId) {
                    return finishStartupAttempt(
                        media,
                        handle,
                        'ready',
                        {
                            attemptId: media.pmms.startupAttemptId,
                            playbackToken: media.pmms.startupPlaybackToken || media.pmms.playbackToken,
                            metadata: metadata
                        }
                    );
                }

                if (typeof media.pmms.onReady === 'function') {
                    media.pmms.onReady(media, metadata);
                    media.pmms.onReady = null;
                }

                if (media.pmms.transitionSeconds > 0) {
                    var fadeNow = getNowMs();
                    media.pmms.fadeInStartedAt = fadeNow;
                    media.pmms.fadeInEndsAt = fadeNow + (media.pmms.transitionSeconds * 1000);
                }

                callMediaPlaybackMethod(media, 'play');
                return true;
            };

            var trackStartupSignals = !!startupAttemptId;
            var startupCleanupFns = [];
            var addReadySignalListener = function(target, eventName, handler) {
                if (!target || typeof target.addEventListener !== 'function') {
                    return;
                }

                target.addEventListener(eventName, handler);
                if (trackStartupSignals) {
                    startupCleanupFns.push(function() {
                        if (typeof target.removeEventListener === 'function') {
                            try {
                                target.removeEventListener(eventName, handler);
                            } catch (_) {}
                        }
                    });
                }
            };

            var startupSignalTargets = [media];
            var nativeStartupNode = getMediaElementNode(media);
            if (nativeStartupNode && nativeStartupNode !== media) {
                startupSignalTargets.push(nativeStartupNode);
            }

            startupSignalTargets.forEach(function(target) {
                addReadySignalListener(target, 'loadedmetadata', function () {
                    applyPreferredAudioTrack(media, options, true);
                    schedulePlaybackMetadataUpdate(media, options, 'loadedmetadata');
                    completeMediaInitialization('loadedmetadata');
                });
                addReadySignalListener(target, 'loadeddata', function () {
                    applyPreferredAudioTrack(media, options, true);
                    schedulePlaybackMetadataUpdate(media, options, 'loadeddata');
                    completeMediaInitialization('loadedmetadata');
                });
                addReadySignalListener(target, 'canplay', function () {
                    applyPreferredAudioTrack(media, options, true);
                    schedulePlaybackMetadataUpdate(media, options, 'canplay');
                    completeMediaInitialization('canplay');
                });
                addReadySignalListener(target, 'playing', function () {
                    schedulePlaybackMetadataUpdate(media, options, 'playing');
                    completeMediaInitialization('playing');
                });
            });

            startupSignalTargets.forEach(function(target) {
                if (!target || typeof target.addEventListener !== 'function') {
                    return;
                }
                target.addEventListener('ended', function() {
                    notifyPlaybackEnded(media, options, 'media_ended');
                });
            });

            if (media.youTubeApi && typeof media.youTubeApi.addEventListener === 'function') {
                var onYoutubeStartupStateChange = function (event) {
                    var state = Number(event && event.data);
                    if (state === 1 || state === 2 || state === 3) {
                        media.pmms.youtubeReady = true;
                        completeMediaInitialization(state === 1 ? 'youtube_playing' : 'youtube_paused');
                    }
                };

                media.youTubeApi.addEventListener('onStateChange', onYoutubeStartupStateChange);
                if (trackStartupSignals) {
                    startupCleanupFns.push(function() {
                        if (typeof media.youTubeApi.removeEventListener === 'function') {
                            try {
                                media.youTubeApi.removeEventListener('onStateChange', onYoutubeStartupStateChange);
                            } catch (_) {}
                        }
                    });
                }
            }

            if (trackStartupSignals) {
                var readinessPollId = setInterval(function() {
                    completeMediaInitialization('poll');
                }, 250);
                startupCleanupFns.push(function() {
                    clearInterval(readinessPollId);
                });

                var activationGraceId = setTimeout(function() {
                    completeMediaInitialization('activation_grace');
                }, 1250);
                startupCleanupFns.push(function() {
                    clearTimeout(activationGraceId);
                });

                setStartupSignalHandlers(media, startupCleanupFns);
            } else {
                clearStartupSignalHandlers(media);
            }

            media.addEventListener('playing', function () {
                if (media.pmms && media.pmms.videoHealth) {
                    media.pmms.videoHealth.recoveries = 0;
                    resetVideoHealthState(media);
                }

                if (!media.pmms.eqAdded) {
                    media.pmms.eqAdded = !!eqGraph.initAudioGraph(getMediaElementNode(media) || media);
                }

                if (options.filter && !media.pmms.filterAdded) {
                    applyRadioFilter(media);
                }

                if (options.visualization && !media.pmms.visualizationAdded) {
                    createAudioVisualization(media, options.visualization);
                }
            });

            var hlsPlaybackManaged = setupHlsPlayback(media, options, completeMediaInitialization, reportPlaybackFailure);
            if (!hlsPlaybackManaged) {
                try {
                    var playbackNode = getMediaElementNode(media);
                    var playTarget = playbackNode && typeof playbackNode.play === 'function' ? playbackNode : media;
                    var playResult = playTarget.play();
                    if (playTarget !== media && typeof media.play === 'function') {
                        try {
                            media.play();
                        } catch (_) {}
                    }
                    if (playResult && typeof playResult.then === 'function') {
                        playResult.then(function() {
                            completeMediaInitialization('playing');
                        }).catch(function(error) {
                            if (trackStartupSignals && media.pmms && media.pmms.startupAttemptId && !media.pmms.startupReadySent) {
                                reportPlaybackFailure((error && error.message) || 'Playback could not start.');
                            }
                        });
                    }
                } catch (error) {
                    if (trackStartupSignals && media.pmms && media.pmms.startupAttemptId && !media.pmms.startupReadySent) {
                        reportPlaybackFailure((error && error.message) || 'Playback could not start.');
                    }
                }
            }

            setTimeout(function() {
                completeMediaInitialization('bootstrap');
            }, 0);
        }
    });

    return player;
}

function getPlayer(handle, options, startupAttemptId, playbackToken, startupTimeoutMs) {
    if (handle === undefined || handle === null) {
        return null;
    }

    var id = getCanonicalPlayerId(handle);
    var player = document.getElementById(id);

    if (!player && options && options.url) {
        player = initPlayer(id, handle, options, startupAttemptId, playbackToken, startupTimeoutMs);
    }

    if (player && !player.pmms) {
        player.pmms = {
            initialized: false,
            attenuationFactor: 0,
            volumeFactor: 1.0,
            currentUrl: options && options.url ? options.url : '',
            transitionSeconds: getEffectiveTransitionSeconds(options),
            fadeInStartedAt: 0,
            fadeInEndsAt: 0,
            inRange: true,
            lastDistance: -1,
            lastDistanceAt: 0,
            playbackToken: playbackToken || (options && options.playbackToken) || null,
            startupAttemptId: startupAttemptId || null,
            startupPlaybackToken: startupAttemptId ? (playbackToken || (options && options.playbackToken) || null) : null,
            startupReadySent: false,
            awaitingActivation: !!startupAttemptId,
            startupWatchdogId: null
        };
    }

    if (player) {
        ensurePlayerState(player);
        if (playbackToken || (options && options.playbackToken)) {
            player.pmms.playbackToken = playbackToken || (options && options.playbackToken) || player.pmms.playbackToken || null;
        }
        if (startupAttemptId) {
            markStartupTracking(
                player,
                startupAttemptId,
                playbackToken || (options && options.playbackToken) || null,
                startupTimeoutMs || (options && options.startupTimeoutMs),
                handle,
                options
            );
        } else if (player.pmms.awaitingActivation && options && options.url) {
            clearStartupTracking(player);
        }
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
    if (player && player.externalYoutube && typeof player.externalYoutube.post === 'function') {
        var externalVolume = clamp01(target);
        try {
            player.externalYoutube.post({
                command: 'volume',
                volume: externalVolume,
                muted: externalVolume <= 0
            });
        } catch (_) {}
        player.volume = externalVolume;
        return;
    }

    if (player && player.youTubeApi && typeof player.youTubeApi.setVolume === 'function') {
        var youtubeVolume = Math.round(clamp01(target) * 100);
        try {
            player.youTubeApi.setVolume(youtubeVolume);
            if (youtubeVolume <= 0 && typeof player.youTubeApi.mute === 'function') {
                player.youTubeApi.mute();
            } else if (typeof player.youTubeApi.unMute === 'function') {
                player.youTubeApi.unMute();
            }
        } catch (_) {}
        player.volume = clamp01(target);
        return;
    }

    if (player && player.twitchApi && typeof player.twitchApi.setVolume === 'function') {
        var twitchVolume = clamp01(target);
        try {
            player.twitchApi.setVolume(twitchVolume);
            if (typeof player.twitchApi.setMuted === 'function') {
                player.twitchApi.setMuted(twitchVolume <= 0);
            }
        } catch (_) {}
        player.volume = twitchVolume;
        return;
    }

    var volumeNode = getMediaElementNode(player) || player;
    if (!volumeNode) {
        return;
    }

    var normalizedTarget = clamp01(target);
    var current = clamp01(Number(volumeNode.volume));
    var delta = normalizedTarget - current;

    if (Math.abs(delta) <= 0.003) {
        volumeNode.volume = normalizedTarget;
        if (player && player !== volumeNode) {
            try {
                player.volume = normalizedTarget;
            } catch (_) {}
        }
        return;
    }

    var step = Math.min(0.08, Math.max(0.01, Math.abs(delta) * 0.35));
    volumeNode.volume = current + (delta > 0 ? step : -step);

    if ((delta > 0 && volumeNode.volume > normalizedTarget) || (delta < 0 && volumeNode.volume < normalizedTarget)) {
        volumeNode.volume = normalizedTarget;
    }

    if (player && player !== volumeNode) {
        try {
            player.volume = volumeNode.volume;
        } catch (_) {}
    }
}

function startup(data) {
    if (!data || !data.options || !data.options.url || !data.attemptId) {
        debugLog('dui_browser', 'startup ignored: missing data/options/url/attempt', {
            handle: data && data.handle !== undefined ? data.handle : null,
            hasOptions: !!(data && data.options),
            hasUrl: !!(data && data.options && data.options.url),
            hasAttemptId: !!(data && data.attemptId)
        });
        return;
    }

    showLoadingIcon();

    data.options.offset = parseTimecode(data.options.offset);
    if (!data.options.title) {
        data.options.title = data.options.url;
    }
    data.options.playbackToken = data.playbackToken || data.options.playbackToken || null;
    data.options.startupTimeoutMs = data.startupTimeoutMs || data.options.startupTimeoutMs || defaultStartupTimeoutMs;

    debugLog('dui_browser', 'startup requested', {
        handle: data.handle,
        attemptId: data.attemptId,
        playbackToken: data.options.playbackToken,
        url: redactUrlForDebug(data.options.url),
        resolver: data.options.resolver || null,
        startupTimeoutMs: data.options.startupTimeoutMs
    });

    var existing = document.getElementById(getCanonicalPlayerId(data.handle));
    if (existing && existing.pmms && existing.pmms.currentUrl && existing.pmms.currentUrl !== data.options.url) {
        if (existing.pmms.localRecoveryPending || existing.pmms.recovering || isProviderBackedStartup(data.options, existing)) {
            parkStalePlayerForRecovery(existing, data.handle);
        } else {
            removePlayer(existing);
        }
    }

    getPlayer(data.handle, data.options, data.attemptId, data.options.playbackToken, data.options.startupTimeoutMs);
}

function stop(handle) {
    var player = getPlayer(handle);
    if (player) {
        removePlayer(player);
    }
    removeStalePlayersForHandle(handle);
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

    var player = getPlayer(data.handle, data.options, null, data.options.playbackToken || null, null);
    if (!player) {
        return;
    }

    if (player.pmms && player.pmms.currentUrl && player.pmms.currentUrl !== data.options.url) {
        if (player.pmms.startupAttemptId && !player.pmms.startupReadySent) {
            debugLog('dui_browser', 'update ignored while replacement startup is loading', {
                handle: data.handle,
                currentUrl: redactUrlForDebug(player.pmms.currentUrl),
                updateUrl: redactUrlForDebug(data.options.url)
            });
            return;
        }
        removePlayer(player);
        player = getPlayer(data.handle, data.options, null, data.options.playbackToken || null, null);
        if (!player) {
            return;
        }
    }

    ensurePlayerState(player);
    clearStartupTracking(player);
    var incomingPlaybackToken = data.options.playbackToken || player.pmms.playbackToken || null;
    if (String(player.pmms.playbackToken || '') !== String(incomingPlaybackToken || '')) {
        player.pmms.endedSent = false;
    }
    player.pmms.playbackToken = incomingPlaybackToken;
    player.pmms.latestOptions = data.options;
    player.pmms.transitionSeconds = getEffectiveTransitionSeconds(data.options);
    if (data.options.video === false) {
        stopVideoHealthMonitor(player);
    } else {
        startVideoHealthMonitor(player, data.options);
    }
    if (applyPreferredAudioTrack(player, data.options, false)) {
        schedulePlaybackMetadataUpdate(player, data.options, 'audio_track_applied');
    }

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

    var playbackState = getPlaybackNodeState(player);
    var playbackNode = playbackState.node || player;
    if (playbackState.readyState > 0 || playbackState.hasDecodedFrames || playbackState.hasVideoSize) {
        var targetVolume = 0;
        var pausedByState = data.options.paused === true;
        var inRange = player.pmms.inRange === true;
        var serverVolume = Number(data.volume);
        if (!Number.isFinite(serverVolume)) {
            serverVolume = 100;
        }

        if (!pausedByState && inRange && !data.options.muted && serverVolume > 0) {
            var normalizedDistance = 1;
            if (range > 0) {
                normalizedDistance = clamp01(Math.max(0, distance) / range);
            } else if (distance <= 0) {
                normalizedDistance = 0;
            }

            var curveGain = Math.pow(Math.max(0, 1 - normalizedDistance), Math.max(0.2, rangeCurveExponent));
            var attenuationModifier = 1 / (1 + (Math.max(0, Number(player.pmms.attenuationFactor) || 0) * normalizedDistance));
            var attenuationBase = curveGain * attenuationModifier * player.pmms.volumeFactor;
            targetVolume = clamp01(attenuationBase * (serverVolume / 100));
            targetVolume = clamp01(targetVolume * getFadeInGain(player, nowMs));
        }

        setVolume(player, targetVolume);

        if (inRange) {
            var syncDuration = Number(data.options.duration);
            if (Number.isFinite(syncDuration) && syncDuration > 0) {
                var targetOffset = Number.isFinite(Number(data.offset)) ? Number(data.offset) : Number(data.options.offset || 0);
                var loopMode = String(data.options.loopMode || (data.options.loop === true ? 'track' : 'off'));
                var currentTime = loopMode === 'track'
                    ? (targetOffset % syncDuration)
                    : Math.min(Math.max(0, targetOffset), Math.max(0, syncDuration - 0.05));
                var currentPlaybackTime = Number(playbackState.currentTime);

                if (Number.isFinite(currentPlaybackTime) && Math.abs(currentTime - currentPlaybackTime) > maxTimeDifference) {
                    setMediaCurrentTime(player, currentTime);
                }
            }
        }

        var playerPaused = playbackNode && playbackNode.paused !== undefined ? playbackNode.paused : player.paused;
        if (player.externalYoutube) {
            playerPaused = playbackState.externalYoutubePaused === true;
        } else if (player.youTubeApi) {
            playerPaused = playbackState.youtubeState !== 1 && playbackState.youtubeState !== 3;
        } else if (player.twitchApi) {
            playerPaused = playbackState.twitchPaused === true;
        }
        var currentVolume = Number(playbackNode && playbackNode.volume);
        if (!Number.isFinite(currentVolume)) {
            currentVolume = Number(player.volume) || 0;
        }

        if (pausedByState) {
            if (!playerPaused) {
                callMediaPlaybackMethod(player, 'pause');
            }
        } else if (inRange) {
            if (playerPaused) {
                callMediaPlaybackMethod(player, 'play');
            }
        } else if (!playerPaused && currentVolume <= 0.01) {
            callMediaPlaybackMethod(player, 'pause');
        }
    }

    setMediaDisplay(player, data.options.video !== false);
}

var eqGraph = (function () {
    var ctx = null;
    var preamp = null;
    var highpass = null;
    var bands = [];
    var compressor = null;
    var analyser = null;
    var analyserActive = false;
    var analyserFrameId = null;
    var activationBound = false;
    var sourceMap = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
    var sourceList = [];
    var BAND_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
    var RAMP_TIME = 0.05;

    function getCtx() {
        if (!ctx) {
            try {
                ctx = new (window.AudioContext || window.webkitAudioContext)();
            } catch (_) {}
        }
        return ctx;
    }

    function resumeAudioContext() {
        var actx = getCtx();
        if (!actx || typeof actx.resume !== 'function' || actx.state !== 'suspended') {
            return;
        }
        try {
            var result = actx.resume();
            if (result && typeof result.catch === 'function') {
                result.catch(function() {});
            }
        } catch (_) {}
    }

    function bindAudioActivation() {
        if (activationBound) {
            return;
        }
        activationBound = true;
        window.addEventListener('pointerdown', resumeAudioContext, { passive: true });
        window.addEventListener('keydown', resumeAudioContext, { passive: true });
        document.addEventListener('pointerdown', resumeAudioContext, { passive: true });
    }

    function ensureGraph() {
        var actx = getCtx();
        if (!actx || preamp) return;
        bindAudioActivation();
        preamp = actx.createGain();
        preamp.gain.value = 1.0;

        highpass = actx.createBiquadFilter();
        highpass.type = 'highpass';
        highpass.frequency.value = 80;
        highpass.Q.value = 0.7;

        for (var i = 0; i < 10; i++) {
            var f = actx.createBiquadFilter();
            f.type = i === 0 ? 'lowshelf' : i === 9 ? 'highshelf' : 'peaking';
            f.frequency.value = BAND_FREQS[i];
            f.gain.value = 0;
            f.Q.value = 1.2;
            bands.push(f);
        }

        compressor = actx.createDynamicsCompressor();
        compressor.threshold.value = -18;
        compressor.knee.value = 6;
        compressor.ratio.value = 3;
        compressor.attack.value = 0.003;
        compressor.release.value = 0.25;

        analyser = actx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.8;

        rebuildChain(false, false);
    }

    function disconnectNode(node) {
        if (node && typeof node.disconnect === 'function') {
            try {
                node.disconnect();
            } catch (_) {}
        }
    }

    function rebuildChain(hpEnabled, compEnabled) {
        var actx = getCtx();
        if (!actx || !preamp) return;
        disconnectNode(preamp);
        disconnectNode(highpass);
        for (var i = 0; i < bands.length; i++) {
            disconnectNode(bands[i]);
        }
        disconnectNode(compressor);
        disconnectNode(analyser);

        var chain = [preamp];
        if (hpEnabled && highpass) chain.push(highpass);
        for (var j = 0; j < bands.length; j++) chain.push(bands[j]);
        if (compEnabled && compressor) chain.push(compressor);
        chain.push(analyser);

        chain.reduce(function(previous, current) {
            previous.connect(current);
            return current;
        });
        chain[chain.length - 1].connect(actx.destination);
    }

    function dbToGain(db) {
        return Math.pow(10, db / 20);
    }

    function ramp(param, value, actx) {
        var now = actx.currentTime;
        param.cancelScheduledValues(now);
        param.setValueAtTime(param.value, now);
        param.linearRampToValueAtTime(value, now + RAMP_TIME);
    }

    function applyProfile(profile) {
        ensureGraph();
        var actx = getCtx();
        if (!actx || !preamp) return;

        if (!profile || !profile.enabled) {
            ramp(preamp.gain, 1.0, actx);
            for (var i = 0; i < bands.length; i++) {
                ramp(bands[i].gain, 0, actx);
            }
            rebuildChain(false, false);
            return;
        }

        var preampDb = Number(profile.preampDb) || 0;
        ramp(preamp.gain, dbToGain(preampDb), actx);

        var profileBands = Array.isArray(profile.bands) ? profile.bands : [];
        for (var j = 0; j < bands.length; j++) {
            ramp(bands[j].gain, Number(profileBands[j]) || 0, actx);
        }

        rebuildChain(profile.highpassEnabled === true, profile.compressorEnabled === true);
    }

    function getStoredSource(mediaEl) {
        if (!mediaEl) {
            return null;
        }
        if (sourceMap) {
            return sourceMap.get(mediaEl) || null;
        }
        for (var i = 0; i < sourceList.length; i++) {
            if (sourceList[i].media === mediaEl) {
                return sourceList[i].source;
            }
        }
        return null;
    }

    function storeSource(mediaEl, source) {
        if (sourceMap) {
            sourceMap.set(mediaEl, source);
            return;
        }
        sourceList.push({ media: mediaEl, source: source });
    }

    function initAudioGraph(mediaEl) {
        ensureGraph();
        var actx = getCtx();
        if (!mediaEl || !actx || !preamp) return null;
        var existingSource = getStoredSource(mediaEl);
        if (existingSource) {
            resumeAudioContext();
            return existingSource;
        }
        try {
            var src = actx.createMediaElementSource(mediaEl);
            src.connect(preamp);
            storeSource(mediaEl, src);
            resumeAudioContext();
            return src;
        } catch (_) {
            return null;
        }
    }

    function startAnalyserStream() {
        if (analyserFrameId) return;
        var buf = null;
        function frame() {
            if (!analyserActive || !analyser) { analyserFrameId = null; return; }
            if (!buf || buf.length !== analyser.frequencyBinCount) {
                buf = new Float32Array(analyser.frequencyBinCount);
            }
            analyser.getFloatFrequencyData(buf);
            try {
                window.parent.postMessage({ type: 'eqAnalyserFrame', bins: Array.from(buf) }, '*');
            } catch (_) {}
            analyserFrameId = requestAnimationFrame(frame);
        }
        analyserFrameId = requestAnimationFrame(frame);
    }

    function stopAnalyserStream() {
        if (analyserFrameId) {
            cancelAnimationFrame(analyserFrameId);
            analyserFrameId = null;
        }
    }

    return {
        applyProfile: applyProfile,
        connectMedia: initAudioGraph,
        initAudioGraph: initAudioGraph,
        setAnalyserActive: function (active) {
            analyserActive = !!active;
            if (analyserActive) {
                ensureGraph();
                resumeAudioContext();
                startAnalyserStream();
            }
            else stopAnalyserStream();
        },
    };
})();

window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || !data.type) {
        return;
    }

    switch (data.type) {
        case 'startup':
            whenStartupConfigLoaded(function() {
                startup(data);
            });
            break;
        case 'stop':
            stop(data.handle);
            break;
        case 'update':
            update(data);
            break;
        case 'DuiBrowser:init':
            whenStartupConfigLoaded(function() {
                sendMessage('DuiBrowser:initDone', { handle: data.handle });
            });
            break;
        case 'applyEqProfile':
            eqGraph.applyProfile(data.profile);
            break;
        case 'setEqAnalyserActive':
            eqGraph.setAnalyserActive(data.active);
            break;
    }
});


window.addEventListener('load', function () {
    setResourceNameFromUrl();

    sendMessage('duiStartup', {})
        .then(function (resp) { return resp.json(); })
        .then(function (resp) {
            if (resp.audioVisualizations !== undefined) {
                audioVisualizations = resp.audioVisualizations;
            }
            if (resp.currentServerEndpoint !== undefined) {
                currentServerEndpoint = resp.currentServerEndpoint;
            }
            if (Number.isFinite(Number(resp.defaultTransitionSeconds))) {
                defaultTransitionSeconds = Number(resp.defaultTransitionSeconds);
            }
            if (Number.isFinite(Number(resp.maxTransitionSeconds))) {
                maxTransitionSeconds = Number(resp.maxTransitionSeconds);
            }
            if (Number.isFinite(Number(resp.rangeCurveExponent))) {
                rangeCurveExponent = Number(resp.rangeCurveExponent);
            }
            if (Number.isFinite(Number(resp.startupTimeoutMs))) {
                defaultStartupTimeoutMs = Number(resp.startupTimeoutMs);
            }
            hlsCanvasConfig.enabled = resp.hlsCanvasDownscale !== false;
            if (Number.isFinite(Number(resp.hlsCanvasMaxWidth))) {
                hlsCanvasConfig.maxWidth = Math.max(320, Number(resp.hlsCanvasMaxWidth));
            }
            if (Number.isFinite(Number(resp.hlsCanvasMaxHeight))) {
                hlsCanvasConfig.maxHeight = Math.max(180, Number(resp.hlsCanvasMaxHeight));
            }
            if (Number.isFinite(Number(resp.hlsCanvasMaxFps))) {
                hlsCanvasConfig.maxFps = Math.max(1, Math.min(60, Number(resp.hlsCanvasMaxFps)));
            }
            if (Array.isArray(resp.audioLanguagePriority) && resp.audioLanguagePriority.length) {
                audioLanguagePriority = resp.audioLanguagePriority.slice();
            }
            if (resp.youtube !== undefined) {
                youtubeExternalPlayerConfig = normalizeYoutubeExternalPlayerConfig(resp.youtube);
            }
            if (resp.player !== undefined) {
                hostedPlayerConfig = normalizeHostedPlayerConfig(resp.player);
            }
            if (resp.debug !== undefined) {
                debugConfig = resp.debug || { enabled: false };
            }
            debugLog('dui_browser', 'startup config loaded', {
                defaultStartupTimeoutMs: defaultStartupTimeoutMs,
                currentServerEndpoint: currentServerEndpoint,
                hlsCanvas: hlsCanvasConfig,
                audioLanguagePriority: audioLanguagePriority,
                youtubeExternalPlayer: {
                    enabled: canUseExternalYoutubePlayer(),
                    prefer: youtubeExternalPlayerConfig.preferExternalPlayer === true,
                    frontendFallback: youtubeExternalPlayerConfig.allowFrontendFallback === true,
                    frontendInstanceCount: Array.isArray(youtubeExternalPlayerConfig.frontendInstances)
                        ? youtubeExternalPlayerConfig.frontendInstances.length
                        : 0
                },
                hostedPlayer: {
                    enabled: !!(hostedPlayerConfig && hostedPlayerConfig.hostedPlayerUrl),
                    useHostedPlayer: hostedPlayerConfig && hostedPlayerConfig.useHostedPlayer !== false
                }
            });
            finishStartupConfigLoad();
        })
        .catch(function (err) {
            debugLog('dui_browser', 'startup config failed', {
                message: err && err.message ? err.message : String(err)
            });
            finishStartupConfigLoad();
        });
});
