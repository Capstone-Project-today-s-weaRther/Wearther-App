import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, ArrowRight, Camera, Check, ChevronDown, ChevronRight,
  Cloud, CloudDrizzle, CloudFog, CloudMoon, CloudRain, CloudSnow, CloudSun,
  House, MapPin, Search, Shirt, Sun, UserRound, Wind, Droplets, Umbrella, X, RotateCcw,
} from 'lucide-react';
import {
  buildRecommendations, fetchWeather, findCurrentLocationRegion, findTempRange,
  getFeedbackTempOffset, getSessionId, loadFashionRows, loadFeedback,
  loadRegionOffset, loadWeatherClothingMap, regionDisplay, saveFeedback,
  searchRegions,
} from './data.js';
import { isSupabaseConfigured } from './supabase.js';

const SNAPSHOT_KEY = 'wearther_daily_snapshot_v1';
const PROFILE_KEY = 'wearther_profile_v1';
const SURVEY_KEY = 'wearther_survey_v1';
const LABELS = { cold: '추웠어요', good: '딱 좋았어요', hot: '더웠어요' };
const EMOJIS = { cold: '🥶', good: '😊', hot: '🥵' };
const THERMAL_LABELS = {
  cold: '팀 추위', normal: '팀 보통', hot: '팀 더위',
};

function readJson(key, fallback = null) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; }
  catch { return fallback; }
}
function writeJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 저장공간 제한 환경 */ }
}
function StatusBar() { return null; } // 앱 미리보기에서는 OS 상태바(시간·통신·배터리)를 표시하지 않습니다.
function WeatherMark({ code = 'cloud', size = 48 }) {
  const p = { size, strokeWidth: 1.7 };
  if (code === 'sun') return <span className={`weather-mark sun-mark ${size <= 24 ? 'weather-mark-small' : ''}`}><Sun {...p}/></span>;
  if (code === 'rain') return <span className={`weather-mark rain-mark ${size <= 24 ? 'weather-mark-small' : ''}`}><CloudRain {...p}/></span>;
  if (code === 'sleet') return <span className={`weather-mark rain-mark ${size <= 24 ? 'weather-mark-small' : ''}`}><CloudDrizzle {...p}/></span>;
  if (code === 'snow') return <span className={`weather-mark snow-mark ${size <= 24 ? 'weather-mark-small' : ''}`}><CloudSnow {...p}/></span>;
  if (code === 'overcast') return <span className={`weather-mark overcast-mark ${size <= 24 ? 'weather-mark-small' : ''}`}><CloudFog {...p}/></span>;
  if (code === 'night') return <span className={`weather-mark night-mark ${size <= 24 ? 'weather-mark-small' : ''}`}><CloudMoon {...p}/></span>;
  if (code === 'cloud') return <span className={`weather-mark cloud-mark ${size <= 24 ? 'weather-mark-small' : ''}`}><CloudSun {...p}/></span>;
  return <span className={`weather-mark cloud-mark ${size <= 24 ? 'weather-mark-small' : ''}`}><Cloud {...p}/></span>;
}
function weatherText(code) {
  return ({ sun: '맑음', cloud: '구름 조금', overcast: '흐림', rain: '비', sleet: '비 또는 눈', snow: '눈', night: '맑은 밤' })[code] || '구름 조금';
}
function regionLabel(region) {
  if (!region) return '';
  return region.label || [region.sido, region.sigungu, region.dong].filter(Boolean).join(' ');
}
function shortRegion(region) {
  return [region?.displayDong || region?.dong || region?.sigungu, region?.sido].filter(Boolean).slice(0, 1).join('') || regionLabel(region);
}
function clothingText(row) {
  return Array.isArray(row?.clothing_items) ? row.clothing_items.join(' · ') : '';
}
const TOP_ITEM_PATTERN = /(맨투맨|니트|터틀넥|목폴라|히트텍|셔츠|블라우스|티셔츠|스웨터|가디건|후드|베스트|조끼|반팔|긴팔|민소매|폴로|상의|탑|풀오버|플리스|크루넥)/i;
const OUTER_ITEM_PATTERN = /(코트|패딩|자켓|재킷|야상|무스탕|점퍼|바람막이|트렌치|아우터|블레이저)/i;
const GENERIC_LOOK_PATTERN = /(주말코디|주말룩|오늘코디|코디추천|출근코디|모임룩|데이트룩|캠퍼스룩|여행룩)/i;
function outfitLookTitle(outfit) {
  const items = Array.isArray(outfit?.clothing_items) ? outfit.clothing_items.map((v) => String(v).trim()).filter(Boolean) : [];
  const top = items.find((v) => TOP_ITEM_PATTERN.test(v) && !OUTER_ITEM_PATTERN.test(v));
  const outer = items.find((v) => OUTER_ITEM_PATTERN.test(v));
  if (outer && top) return `${outer}와 ${top} 레이어드 룩`;
  if (top) return `${top} 포인트 룩`;
  if (outer) return `${outer} 데일리 룩`;
  const useful = items.slice(0, 2);
  return useful.length ? `${useful.join(' · ')} 데일리 룩` : '오늘의 데일리 룩';
}
function outfitLookDescription(outfit, snapshot) {
  const items = Array.isArray(outfit?.clothing_items) ? outfit.clothing_items.filter(Boolean) : [];
  const mainItems = items.slice(0, 3).join(' · ');
  const tempText = snapshot?.effectiveTemp == null ? '' : `체감 ${snapshot.effectiveTemp}°C에 맞춰`;
  return mainItems ? `${tempText} ${mainItems} 조합으로 구성한 오늘의 옷차림이에요.`.trim() : '현재 날씨와 체감온도를 고려해 고른 오늘의 옷차림이에요.';
}
function reviewDate(value, compact = false) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ko-KR', compact
    ? { year: 'numeric', month: '2-digit', day: '2-digit' }
    : { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date).replace(/\. /g, '.').replace(/\.$/, '');
}
function hourLabel(value) {
  if (!value) return '—';
  const s = String(value);
  return s.includes(':') ? s : `${s.slice(0, 2)}시`;
}
function kstDateString(value) {
  if (!value) return '';
  const s = String(value);
  if (/^\d{8}$/.test(s)) return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
  return s.slice(0, 10);
}
function buildWeek(weather) {
  if (Array.isArray(weather?.daily) && weather.daily.length) return weather.daily.slice(0, 7);
  const grouped = new Map();
  (weather?.hourly || []).forEach((h) => {
    const date = kstDateString(h.date || new Date().toISOString());
    if (!grouped.has(date)) grouped.set(date, []);
    grouped.get(date).push(h);
  });
  const result = [...grouped.entries()].map(([date, rows]) => {
    const temps = rows.map((r) => Number(r.temp)).filter(Number.isFinite);
    const codes = rows.map((r) => r.sky?.code).filter(Boolean);
    const code = codes.sort((a, b) => codes.filter((x) => x === b).length - codes.filter((x) => x === a).length)[0] || 'cloud';
    return { date, min: temps.length ? Math.min(...temps) : null, max: temps.length ? Math.max(...temps) : null, code, text: weatherText(code), available: true };
  });
  return result.slice(0, 7);
}
function dayName(date, index) {
  if (index === 0) return '오늘';
  if (index === 1) return '내일';
  const value = new Date(`${kstDateString(date)}T12:00:00+09:00`);
  return Number.isNaN(value.getTime()) ? ['월','화','수','목','금','토','일'][index % 7] : new Intl.DateTimeFormat('ko-KR', { weekday: 'short' }).format(value);
}
function makeWeekRows(weather) {
  const actual = buildWeek(weather);
  const rows = [...actual];
  while (rows.length < 7) rows.push({ date: '', min: null, max: null, code: null, text: '예보 미제공', available: false });
  return rows;
}
function regionTextForSearch(item) {
  if (item.isAggregate) return item.label || `${item.sido} ${item.sigungu} 전체`;
  return [item.sido, item.sigungu, item.dong].filter(Boolean).join(', ');
}

export default function App() {
  const [snapshot, setSnapshot] = useState(() => readJson(SNAPSHOT_KEY));
  const [profile, setProfile] = useState(() => readJson(PROFILE_KEY));
  const [screen, setScreen] = useState(() => readJson(PROFILE_KEY) && readJson(SNAPSHOT_KEY) ? 'app' : readJson('wearther_initial_region') ? 'survey' : 'welcome');
  const [modal, setModal] = useState('');
  const [activeTab, setActiveTab] = useState('home');
  const [pickerMode, setPickerMode] = useState('initial');
  const [initialRegion, setInitialRegion] = useState(() => readJson('wearther_initial_region'));
  const [selectedRegion, setSelectedRegion] = useState(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [survey, setSurvey] = useState(() => readJson(SURVEY_KEY, { gender: '', thermal: '', nickname: '' }));
  const [surveyStep, setSurveyStep] = useState(1);
  const [loadingMessage, setLoadingMessage] = useState('오늘 입을 옷을 찾고 있어요');
  const [regionSetupPhase, setRegionSetupPhase] = useState('loading');
  const [cameraStream, setCameraStream] = useState(null);
  const [cameraError, setCameraError] = useState('');
  const profileFileInputRef = useRef(null);
  const cameraVideoRef = useRef(null);
  const cameraStreamRef = useRef(null);
  const hourlyScrollRef = useRef(null);
  const [reviews, setReviews] = useState([]);
  const [feedbackType, setFeedbackType] = useState('');
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [savedReview, setSavedReview] = useState(null);
  const [reviewsReturnTo, setReviewsReturnTo] = useState('mypage');
  const sessionId = useMemo(() => getSessionId(), []);

  useEffect(() => {
    let live = true;
    loadFeedback(sessionId).then((rows) => { if (live) setReviews(rows || []); });
    return () => { live = false; };
  }, [sessionId]);

  useEffect(() => {
    if (screen !== 'region-setup-loading') return undefined;
    setRegionSetupPhase('loading');
    const completeTimer = window.setTimeout(() => setRegionSetupPhase('complete'), 900);
    const nextTimer = window.setTimeout(() => { setSurveyStep(1); setScreen('survey'); }, 2900);
    return () => { window.clearTimeout(completeTimer); window.clearTimeout(nextTimer); };
  }, [screen, initialRegion?.id]);

  useEffect(() => {
    if (cameraStream && cameraVideoRef.current) {
      cameraVideoRef.current.srcObject = cameraStream;
      cameraVideoRef.current.play?.().catch(() => {});
    }
  }, [cameraStream, modal]);

  useEffect(() => () => {
    cameraStreamRef.current?.getTracks?.().forEach((track) => track.stop());
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (!q) { setResults([]); setSearching(false); return; }
    let live = true;
    setSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const found = await searchRegions(q);
        if (live) setResults(found || []);
      } catch (error) {
        if (live) { setResults([]); setLocationError(error?.message || '지역 검색에 실패했습니다.'); }
      } finally { if (live) setSearching(false); }
    }, 180);
    return () => { live = false; window.clearTimeout(timer); };
  }, [query]);

  function startLocationPicker(mode) {
    setPickerMode(mode);
    setQuery(''); setResults([]); setLocationError('');
    setSelectedRegion(null);
    setModal('location-picker');
  }

  function acceptInitialRegion(region) {
    setLocationError('');
    setInitialRegion(region);
    writeJson('wearther_initial_region', region);
    setSurveyStep(1);
    setModal('');
    setRegionSetupPhase('loading');
    setScreen('region-setup-loading');
  }

  async function useCurrentLocation() {
    setLocating(true); setLocationError('');
    try {
      const region = await findCurrentLocationRegion();
      if (pickerMode === 'initial') acceptInitialRegion(region);
      else setSelectedRegion(region);
    } catch (error) {
      setLocationError(error?.message || '현위치를 확인하지 못했습니다. 지역을 직접 검색해주세요.');
    } finally { setLocating(false); }
  }

  async function loadForRegion(region, isFirstSetup = false) {
    setScreen('loading'); setLoadError('');
    setLoadingMessage(isFirstSetup ? `${profile?.nickname || survey.nickname || ''}님이 오늘 입을 옷을 찾고 있어요` : '선택한 지역의 날씨와 코디를 새로 찾고 있어요');
    try {
      const normalized = { ...region, label: region.label || regionTextForSearch(region), nx: Number(region.nx), ny: Number(region.ny) };
      const [weather, rows, mapping, currentReviews, feedbackOffset, regionOffset] = await Promise.all([
        fetchWeather(normalized), loadFashionRows(normalized.zone), loadWeatherClothingMap(), loadFeedback(sessionId),
        getFeedbackTempOffset(sessionId), loadRegionOffset(normalized.zone),
      ]);
      const personalOffset = profile?.thermal === 'cold' ? -1.5 : profile?.thermal === 'hot' ? 1.5 : 0;
      const effectiveTemp = Number(weather.temp) + Number(feedbackOffset || 0) + Number(regionOffset || 0) + personalOffset;
      const band = findTempRange(effectiveTemp, mapping) || mapping[0];
      const recommendations = band ? buildRecommendations({ rows, band, effectiveTemp, feedbacks: currentReviews }) : { outfit: null, top4: [], selectedRange: '' };
      const next = {
        region: normalized, weather, recommendations,
        effectiveTemp: Math.round(effectiveTemp * 10) / 10,
        tempOffset: Math.round((Number(feedbackOffset || 0) + Number(regionOffset || 0)) * 10) / 10,
        regionOffset: Number(regionOffset || 0), feedbackOffset: Number(feedbackOffset || 0), personalOffset,
        bandLabel: band?.temp_range_label || '', updatedAt: new Date().toISOString(), latestReview: currentReviews?.[0] || null,
      };
      setSnapshot(next); writeJson(SNAPSHOT_KEY, next); writeJson('wearther_region', normalized);
      setReviews(currentReviews || []);
      setScreen('app'); setActiveTab('home');
      if (isFirstSetup) setModal('welcome-sheet');
      else setModal('');
    } catch (error) {
      setLoadError(error?.message || '날씨와 코디 정보를 불러오지 못했습니다.');
      setScreen(isFirstSetup ? 'survey' : 'app');
    }
  }

  async function applySelectedRegion() {
    if (!selectedRegion) return;
    const region = selectedRegion;
    if (pickerMode === 'initial') acceptInitialRegion(region);
    else {
      setModal('');
      await loadForRegion(region, false);
    }
  }

  async function finishSurvey() {
    if (!initialRegion || survey.gender === '' || survey.thermal === '' || survey.nickname.trim().length < 2) return;
    const nextProfile = { ...survey, nickname: survey.nickname.trim() };
    setProfile(nextProfile); writeJson(PROFILE_KEY, nextProfile);
    await loadForRegion(initialRegion, true);
  }

  function backFromSurvey() {
    if (surveyStep > 1) setSurveyStep((s) => s - 1);
    else { setScreen('location'); setInitialRegion(null); }
  }

  function openReviewForm() {
    setFeedbackType(''); setComment(''); setModal(''); setActiveTab('review-form');
  }

  async function submitReview() {
    if (!feedbackType || !snapshot?.recommendations?.outfit) return;
    setSubmitting(true);
    const outfit = snapshot.recommendations.outfit;
    const payload = {
      feedback: feedbackType, region: regionLabel(snapshot.region), zone: snapshot.region.zone,
      temp: snapshot.weather?.temp, temp_range: snapshot.bandLabel,
      outfit_image: outfit.image_url, outfit_title: outfitLookTitle(outfit),
      comment: comment.trim(), session_id: sessionId,
    };
    try {
      const saved = await saveFeedback(payload);
      const review = { ...saved, ...payload, created_at: saved.created_at || new Date().toISOString() };
      const updated = [review, ...reviews.filter((r) => String(r.id) !== String(review.id))];
      setReviews(updated);
      setSavedReview(review);
      const nextSnapshot = { ...snapshot, latestReview: review };
      setSnapshot(nextSnapshot); writeJson(SNAPSHOT_KEY, nextSnapshot);
      setActiveTab('recommend'); setModal('review-success');
    } catch (error) {
      setLoadError(error?.message || '리뷰 등록에 실패했습니다.');
    } finally { setSubmitting(false); }
  }

  function closeSuccess() { setModal(''); setActiveTab('recommend'); }
  function goMyPageAfterReview() { setModal(''); setActiveTab('mypage'); }
  function openMyReviews() { setReviewsReturnTo('mypage'); setActiveTab('reviews'); }

  function saveProfileAvatar(dataUrl) {
    const next = { ...(profile || survey), avatar: dataUrl };
    setProfile(next);
    writeJson(PROFILE_KEY, next);
    setModal('');
    setCameraError('');
  }

  async function handleProfileFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { setCameraError('이미지 파일을 선택해주세요.'); setModal('profile-photo'); return; }
    if (file.size > 12 * 1024 * 1024) { setCameraError('12MB 이하의 사진을 선택해주세요.'); setModal('profile-photo'); return; }
    try {
      const raw = await new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file);
      });
      const dataUrl = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
          const max = 560; const scale = Math.min(1, max / Math.max(image.width, image.height));
          const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale));
          const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.84));
        };
        image.onerror = reject; image.src = raw;
      });
      saveProfileAvatar(dataUrl);
    } catch { setCameraError('사진을 불러오지 못했습니다. 다른 이미지를 선택해주세요.'); setModal('profile-photo'); }
  }

  async function startProfileCamera() {
    setCameraError('');
    if (!navigator.mediaDevices?.getUserMedia) { setCameraError('이 브라우저에서는 카메라 기능을 사용할 수 없습니다.'); setModal('profile-photo'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      cameraStreamRef.current = stream; setCameraStream(stream); setModal('profile-camera');
    } catch (error) {
      setCameraError(error?.name === 'NotAllowedError' ? '브라우저에서 카메라 사용을 허용해주세요.' : '카메라를 열지 못했습니다. 카메라 연결 상태를 확인해주세요.');
      setModal('profile-photo');
    }
  }

  function stopProfileCamera(nextModal = '') {
    cameraStreamRef.current?.getTracks?.().forEach((track) => track.stop());
    cameraStreamRef.current = null; setCameraStream(null); setModal(nextModal); 
  }

  function captureProfileCamera() {
    const video = cameraVideoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) { setCameraError('카메라 화면이 준비되지 않았습니다.'); return; }
    const max = 560; const scale = Math.min(1, max / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas'); canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.86);
    stopProfileCamera(''); saveProfileAvatar(dataUrl);
  }

  function scrollHourly(direction) {
    hourlyScrollRef.current?.scrollBy({ left: direction * 230, behavior: 'smooth' });
  }

  const nickname = profile?.nickname || survey.nickname || '사용자';
  const regionName = snapshot?.region ? regionDisplay(snapshot.region) : '';

  if (screen === 'welcome') return (
    <AppFrame>
      <StatusBar/>
      <div className="welcome-screen">
        <img
          className="welcome-brand-icon"
          src="/assets/brand/wearther-mark.png"
          alt="WEARther 로고"
          draggable="false"
        />
        <img
          className="welcome-brand-title"
          src="/assets/brand/wearther-wordmark-ko.png"
          alt="옷늘날씨"
          draggable="false"
        />
        <img
          className="welcome-brand-subtitle"
          src="/assets/brand/wearther-wordmark-en.png"
          alt="Today's WEARther"
          draggable="false"
        />
        <button className="google-login" onClick={() => setModal('google-consent')}><GoogleMark/>구글로 로그인/회원가입</button>
      </div>
      {modal === 'google-consent' && <div className="screen-dimmer"><div className="google-dialog">
        <p className="google-dialog-title">‘wearther’이(가) ‘account.google.com’을(를)<br/>사용하려고 로그인하려고 합니다.</p>
        <p className="google-dialog-copy">사용자에 관한 정보가 앱 및 웹사이트와 공유하게 됩니다.</p>
        <div className="dialog-actions"><button className="dialog-light" onClick={() => setModal('skip-login')}>취소</button><button className="dialog-dark" onClick={() => setModal('skip-login')}>계속</button></div>
      </div></div>}
      {modal === 'skip-login' && <div className="screen-dimmer"><div className="simple-dialog">
        <div className="simple-dialog-icon"><Check size={23}/></div><h2>로그인을 건너뜁니다.</h2><p>시연 버전으로 계속 이용할 수 있습니다.</p>
        <button className="blue-button" onClick={() => { setModal(''); setScreen('location'); }}>확인</button>
      </div></div>}
    </AppFrame>
  );

  if (screen === 'location') return (
    <AppFrame>
      <StatusBar/>
      <div className="location-intro-screen">
        <div className="location-hero">
          <div className="pin-orbit"><div className="pin-inner"><MapPin size={42} fill="currentColor" strokeWidth={1.5}/></div></div>
          <span className="blue-eyebrow">현재 날씨 확인</span>
          <h1>지금 있는 곳의 날씨를<br/>확인할게요</h1>
          <p>위치는 날씨와 주변 트렌드를 찾는 데 활용됩니다</p>
        </div>
        <div className="location-intro-actions">
          <button className="blue-button" onClick={useCurrentLocation} disabled={locating}>{locating ? '현재 위치 확인 중...' : '위치 사용을 허용하고 계속하기'}</button>
          <button className="white-button" onClick={() => startLocationPicker('initial')}>지역 직접 선택</button>
          {locationError && <p className="inline-error">{locationError}</p>}
        </div>
      </div>
      {modal === 'location-picker' && <LocationPicker
        query={query} setQuery={setQuery} results={results} searching={searching} selected={selectedRegion}
        setSelected={setSelectedRegion} locating={locating} onCurrent={useCurrentLocation}
        onApply={applySelectedRegion} onClose={() => { setModal(''); setLocationError(''); }}
        error={locationError} buttonLabel="선택" initial
      />}
    </AppFrame>
  );

  if (screen === 'region-setup-loading') return (
    <AppFrame>
      <div className={`region-setup-state ${regionSetupPhase === 'complete' ? 'is-complete' : ''}`} aria-live="polite">
        {regionSetupPhase === 'complete' ? <div className="region-setup-check"><Check size={32}/></div> : <div className="region-setup-spinner" aria-label="로딩 중"/>}
        <h1>{regionSetupPhase === 'complete' ? '지역 설정 완료' : '지역 설정 중...'}</h1>
        <p>{regionSetupPhase === 'complete' ? `${shortRegion(initialRegion)} 지역으로 설정했어요.` : '선택한 지역의 정보를 확인하고 있어요.'}</p>
      </div>
    </AppFrame>
  );

  if (screen === 'survey') return (
    <AppFrame>
      <StatusBar/>
      <div className="survey-screen">
        <div className="survey-header"><button className="back-icon" onClick={backFromSurvey} aria-label="이전"><ArrowLeft size={21}/></button></div>
        {surveyStep === 1 && <div className="survey-body">
          <div className="survey-step-label">1/3</div><h1>옷늘날씨에서 어떤 성별의<br/>코디를 찾고 있나요?</h1><p>선택한 성별에 맞는 코디 정보를 추천받을 수 있어요</p>
          <div className="gender-options"><button className={survey.gender === '남성' ? 'selected' : ''} onClick={() => { const s={...survey,gender:'남성'};setSurvey(s);writeJson(SURVEY_KEY,s); }}>남성</button><button className={survey.gender === '여성' ? 'selected' : ''} onClick={() => { const s={...survey,gender:'여성'};setSurvey(s);writeJson(SURVEY_KEY,s); }}>여성</button></div>
        </div>}
        {surveyStep === 2 && <div className="survey-body">
          <div className="survey-step-label">2/3</div><h1>평소 추위나 더위를<br/>얼마나 타는 편인가요?</h1><p>셋 중 한가지만 선택해주세요</p>
          <div className="thermal-options">
            {[['cold','조금만 추워도 춥게 느껴져요'],['normal','보통이에요'],['hot','조금만 더워도 덥게 느껴져요']].map(([key,label])=><button key={key} className={survey.thermal===key?'selected':''} onClick={()=>{const s={...survey,thermal:key};setSurvey(s);writeJson(SURVEY_KEY,s);}}><span className="radio-dot"/><b>{label}</b></button>)}
          </div>
        </div>}
        {surveyStep === 3 && <div className="survey-body">
          <div className="survey-step-label">3/3</div><h1>옷늘날씨에서 사용할<br/>닉네임을 입력해주세요</h1><p>최소 2자 이상 입력해주세요</p>
          <input className="nickname-input" value={survey.nickname} maxLength={16} onChange={(e)=>{const s={...survey,nickname:e.target.value};setSurvey(s);writeJson(SURVEY_KEY,s);}} placeholder="닉네임을 입력하세요" autoFocus/>
        </div>}
        <div className="survey-footer"><button className="blue-button" disabled={surveyStep===1 ? !survey.gender : surveyStep===2 ? !survey.thermal : survey.nickname.trim().length<2} onClick={()=>surveyStep===3?finishSurvey():setSurveyStep(s=>s+1)}>{surveyStep===3?'회원가입하기':'다음 단계로'}</button></div>
      </div>
    </AppFrame>
  );

  if (screen === 'loading') return (
    <AppFrame>
      <StatusBar/>
      <div className="loading-screen">
        <div className="loading-orbit"><div className="loading-core"/></div>
        <h1>{loadingMessage}</h1>
        {loadError && <div className="loading-error"><p>{loadError}</p><button onClick={()=>{setScreen(snapshot?'app':'survey');setLoadError('');}}>돌아가기</button></div>}
      </div>
    </AppFrame>
  );

  if (screen !== 'app' || !snapshot) return <AppFrame><StatusBar/><div className="simple-dialog">지역을 설정해주세요.</div></AppFrame>;

  const weather = snapshot.weather || {};
  const outfit = snapshot.recommendations?.outfit;
  const top4 = snapshot.recommendations?.top4 || [];
  const weekRows = makeWeekRows(weather);
  const topTotal = Number(snapshot.recommendations?.sampleSize) || top4.reduce((n, item) => n + Number(item.count || 0), 0) || 1;
  const currentReviews = reviews || [];

  return (
    <AppFrame app>
      <StatusBar/>
      {activeTab === 'home' && <main className="app-content home-page">
        <h1 className="brand-page-title">옷늘날씨</h1>
        <section className="home-weather-card" onClick={()=>setActiveTab('weather')} role="button" tabIndex={0} onKeyDown={(e)=>{if(e.key==='Enter'||e.key===' '){setActiveTab('weather');}}}>
          <button className="home-region-label" onClick={(e) => {e.stopPropagation();startLocationPicker('change');}}><MapPin size={14} fill="currentColor"/>{shortRegion(snapshot.region)}<ChevronDown size={13}/></button>
          <button className="home-weather-main" onClick={(e)=>{e.stopPropagation();setActiveTab('weather');}} aria-label="자세한 날씨 보기">
            <div><strong>{Math.round(Number(weather.temp)||0)}°C</strong><span>{weather.condition || weatherText(weather.conditionCode)} · 체감 {Math.round(Number(snapshot.effectiveTemp)||0)}°C</span></div>
            <WeatherMark code={weather.conditionCode || 'sun'} size={62}/>
          </button>
          <div className="home-weather-divider"/>
          <div className="home-weather-metrics">
            <div><span>최고 / 최저</span><b>{Math.round(Number(weather.max)||0)}° / {Math.round(Number(weather.min)||0)}°</b></div>
            <div><span>습도</span><b>{weather.humidity == null ? '—' : `${weather.humidity}%`}</b></div>
            <div><span>풍속</span><b>{weather.wind == null ? '—' : `${weather.wind} m/s`}</b></div>
            <div><span>강수확률</span><b>{weather.precipitation == null ? '—' : `${weather.precipitation}%`}</b></div>
          </div>
          <button className="weather-detail-link" onClick={()=>setActiveTab('weather')}>자세한 날씨 보기 <ChevronRight size={14}/></button>
        </section>

        <section className="home-style-section">
          <div className="section-title-row"><h2>지금 거리의 스타일</h2><span>AI가 분석한 실시간 데이터예요</span></div>
          {top4.length ? <div className="style-card-track">{top4.map((item)=>{
            const share=Math.max(1,Math.round((Number(item.count||0)/topTotal)*100));
            return <article className="style-card" key={item.item}>
              <div className="style-image-wrap"><img src={item.image} alt={item.imageAlt || `${item.item} 착용 모습`} loading="lazy" onError={(e)=>{if(item.fallbackImage && e.currentTarget.src !== item.fallbackImage) e.currentTarget.src=item.fallbackImage;}}/><span className="style-percent">{share}%</span></div>
              <div className="style-card-name">{item.item}</div>
            </article>;
          })}</div> : <div className="empty-inline">선택한 권역의 상의 데이터가 아직 없어요.</div>}
          {top4.length > 0 && top4.length < 4 && <p className="top-data-note">이 권역에서 확인된 상의 종류는 {top4.length}개예요. 새 착용 데이터가 추가되면 TOP 4까지 표시됩니다.</p>}
        </section>

        <section className="home-outfit-section">
          <div className="section-title-row"><h2>오늘은 이렇게 입어보세요</h2><button onClick={()=>setActiveTab('recommend')}>자세히 보기</button></div>
          {outfit ? <div className="home-outfit-block">
            <button className="home-outfit-card" onClick={()=>setActiveTab('recommend')}>
              <img src={outfit.image_url} alt="오늘 추천 코디 착용 이미지" loading="lazy"/>
              <span className="home-outfit-card-caption"><b>{outfitLookTitle(outfit)}</b><small>{snapshot.bandLabel} · 체감 {snapshot.effectiveTemp}°C</small></span>
            </button>
            <div className="home-outfit-keywords">{(outfit.clothing_items||[]).map((item,i)=><span key={`${item}-${i}`}>{item}</span>)}</div>
          </div> : <div className="empty-inline">이 권역에는 추천할 코디 이미지가 아직 없어요.</div>}
        </section>
        {weather.demo && <div className="data-source-note">시연용 날씨 데이터 · 실제 날씨는 기상청 API 키 등록 후 표시됩니다.</div>}
      </main>}

      {activeTab === 'weather' && <main className="app-content weather-page">
        <PageHeader title="날씨" onBack={()=>setActiveTab('home')}/>
        <WeatherSummary weather={weather} snapshot={snapshot} onRegion={()=>startLocationPicker('change')} detailed/>
        <section className="hourly-weather-section">
          <div className="hourly-section-heading"><h2>시간대별 날씨</h2><div className="hourly-scroll-controls"><button onClick={()=>scrollHourly(-1)} aria-label="이전 시간대"><ArrowLeft size={15}/></button><button onClick={()=>scrollHourly(1)} aria-label="다음 시간대"><ArrowRight size={15}/></button></div></div>
          <div className="hourly-weather-scroll" ref={hourlyScrollRef}>
            <div className="hourly-weather-grid">
              {(weather.hourly||[]).slice(0,18).map((h,i)=><div className={`hourly-weather-item ${i===0?'now':''}`} key={`${h.date}-${h.time}-${i}`}>
                <span>{i===0?'지금':hourLabel(h.time)}</span><WeatherMark code={h.sky?.code || 'cloud'} size={24}/><b>{h.temp==null?'—':`${Math.round(h.temp)}°`}</b><small>{h.pop==null?'—':`${Math.round(h.pop)}%`}</small>
              </div>)}
              {!(weather.hourly||[]).length && <div className="hourly-empty">시간대별 예보가 없어요.</div>}
            </div>
          </div>
        </section>
        <section className="week-weather-section">
          <div className="week-section-title"><h2>7일 예보</h2><span>최고 / 최저</span></div>
          <div className="week-forecast-list">
            {weekRows.map((day,i)=><div className="week-forecast-row" key={`${day.date}-${i}`}>
              <span className={i===0?'today-label':''}>{day.date?dayName(day.date,i):['오늘','내일','수','목','금','토','일'][i]}</span>
              {day.available===false ? <span className="forecast-unavailable">예보 미제공</span> : <WeatherMark code={day.code||'cloud'} size={22}/>}
              <b>{day.max==null?'—':`${Math.round(day.max)}°`} / {day.min==null?'—':`${Math.round(day.min)}°`}</b>
            </div>)}
          </div>
          {weather.demo && <p className="forecast-note">시연용 날씨 예시입니다. 실제 기상청 응답과 다를 수 있어요.</p>}
          {!weather.demo && weekRows.filter(r=>r.available!==false).length<7 && <p className="forecast-note">기상청 단기예보에서 제공되는 기간까지만 실제 예보가 표시됩니다.</p>}
        </section>
      </main>}

      {activeTab === 'recommend' && <main className="app-content recommend-page">
        <h1 className="recommend-brand">오늘날씨</h1>
        {outfit ? <>
          <div className="recommend-hero-image"><img src={outfit.image_url} alt="오늘 추천 코디 착용 이미지"/></div>
          <section className="recommend-outfit-copy">
            <h2>{outfitLookTitle(outfit)}</h2>
            <p>{outfitLookDescription(outfit, snapshot)}</p>
            <div className="recommend-item-pills">{(outfit.clothing_items||[]).map((v,i)=><span key={`${v}-${i}`}>{v}</span>)}</div>
            <div className="recommend-weather-line">{regionName} · {weather.temp}°C · 체감 {snapshot.effectiveTemp}°C</div>
          </section>
        </> : <div className="empty-inline">이 권역에서 추천할 코디를 찾지 못했어요.</div>}
        <section className="recommend-reviews-section">
          {currentReviews.length===0 ? <div className="no-review-yet"><b>아직 작성된 후기가 없어요</b><p>이 코디를 입어본 첫 후기를 남겨보세요.</p></div> : <div className="recommend-review-list">
            {currentReviews.slice(0,4).map((r,i)=><ReviewCompact key={r.id||i} review={r} nickname={nickname} region={snapshot.region}/>) }
          </div>}
          <button className="review-write-outline" onClick={openReviewForm} disabled={!outfit}>리뷰 작성하기</button>
        </section>
      </main>}

      {activeTab === 'review-form' && <main className="app-content review-form-page">
        <PageHeader title="리뷰 작성하기" onBack={()=>setActiveTab('recommend')}/>
        <div className="review-form-body">
          <section className="review-question-block"><h2>위 옷을 입었더니 어땠나요? <b>*</b></h2>
            <div className="feedback-pills">{['cold','good','hot'].map((type)=><button key={type} className={feedbackType===type?'selected':''} onClick={()=>setFeedbackType(type)}>{LABELS[type]}</button>)}</div>
            {feedbackType && <p className="feedback-impact-hint">{feedbackType==='cold'?'다음 추천의 보온 수준을 +1.5°C 높일게요.':feedbackType==='hot'?'다음 추천의 보온 수준을 -1.5°C 낮출게요.':'지금 가중치를 유지할게요.'}</p>}
          </section>
          <section className="review-comment-block"><h2>위 옷을 입었더니 어땠나요?</h2>
            <textarea value={comment} onChange={(e)=>setComment(e.target.value.slice(0,500))} placeholder="리뷰를 작성해주세요" maxLength={500}/>
            <div className="comment-counter"><span>1자 이상 (선택)</span><span>{comment.length}/500</span></div>
            
          </section>
        </div>
        <div className="review-form-submit"><button className="blue-button" disabled={!feedbackType || submitting} onClick={submitReview}>{submitting?'등록 중...':'등록하기'}</button></div>
      </main>}

      {activeTab === 'mypage' && <main className="app-content mypage-page">
        <PageHeader title="MY" onBack={()=>setActiveTab('home')}/>
        <button className="profile-avatar" onClick={()=>{setCameraError('');setModal('profile-photo');}} aria-label="프로필 사진 변경">
          {profile?.avatar ? <img src={profile.avatar} alt="프로필 사진"/> : <Camera size={24}/>}
          <span className="profile-avatar-edit">변경</span>
        </button>
        <input ref={profileFileInputRef} className="visually-hidden-file" type="file" accept="image/*" onChange={handleProfileFile}/>
        <div className="profile-name">{nickname}</div>
        <button className="my-review-row" onClick={openMyReviews}><b>내 리뷰</b><strong>{currentReviews.length}건</strong><span>전체보기 <ChevronRight size={14}/></span></button>
        <div className="mypage-bottom-note">오늘의 날씨와 나의 체감 경험을 모아 더 나은 코디를 추천해요.</div>
      </main>}

      {activeTab === 'reviews' && <main className="app-content my-reviews-page">
        <PageHeader title="작성한 리뷰" onBack={()=>setActiveTab(reviewsReturnTo)}/>
        {currentReviews.length===0 ? <div className="reviews-empty-state">작성한 리뷰가 없어요</div> : <>
          <h2 className="reviews-count-title">작성한 리뷰 {currentReviews.length}건</h2>
          <div className="my-reviews-list">{currentReviews.map((r,i)=><article className="my-review-card" key={r.id||i}>
            <b>{r.outfit_title || '오늘의 추천 코디'}</b>
            <span className="review-date-and-type">{reviewDate(r.created_at,true)} · {LABELS[r.feedback] || '리뷰'}</span>
            {r.comment && <p>{r.comment}</p>}
          </article>)}</div>
        </>}
      </main>}

      <BottomNav active={activeTab==='weather'?'home':activeTab==='review-form'?'recommend':activeTab} onHome={()=>setActiveTab('home')} onRecommend={()=>setActiveTab('recommend')} onMyPage={()=>setActiveTab('mypage')}/>

      {loadError && <div className="toast-error" role="alert"><span>{loadError}</span><button onClick={()=>setLoadError('')}><X size={15}/></button></div>}

      {modal === 'location-picker' && <LocationPicker
        query={query} setQuery={setQuery} results={results} searching={searching} selected={selectedRegion}
        setSelected={setSelectedRegion} locating={locating} onCurrent={useCurrentLocation}
        onApply={applySelectedRegion} onClose={()=>{setModal('');setLocationError('');}}
        error={locationError} buttonLabel="변경" initial={false}
      />}
      {modal === 'welcome-sheet' && <div className="screen-dimmer welcome-sheet-dimmer"><div className="welcome-bottom-sheet">
        <div className="sheet-handle"/><span className="team-label">{THERMAL_LABELS[profile?.thermal] || '오늘의 팀'}</span>
        <h2>{nickname}님!<br/>옷늘날씨에 오신 걸 환영해요</h2>
        <p>날씨에 어울리는 코디를 추천해 드릴게요.</p>
        <button className="blue-button" onClick={()=>setModal('')}>시작하기</button>
      </div></div>}
      {modal === 'profile-photo' && <div className="screen-dimmer profile-photo-dimmer"><div className="profile-photo-dialog">
        <button className="profile-photo-close" onClick={()=>setModal('')} aria-label="닫기"><X size={19}/></button>
        <div className="profile-photo-dialog-icon"><Camera size={26}/></div><h2>프로필 사진 설정</h2><p>사진을 선택하거나 카메라로 바로 촬영할 수 있어요.</p>
        {cameraError && <p className="profile-camera-error">{cameraError}</p>}
        <button className="blue-button" onClick={()=>profileFileInputRef.current?.click()}>컴퓨터에서 사진 선택</button>
        <button className="white-button" onClick={startProfileCamera}>카메라로 촬영</button>
      </div></div>}
      {modal === 'profile-camera' && <div className="screen-dimmer profile-camera-dimmer"><div className="profile-camera-dialog">
        <div className="profile-camera-heading"><b>프로필 사진 촬영</b><button onClick={()=>stopProfileCamera('')} aria-label="카메라 닫기"><X size={20}/></button></div>
        <video ref={cameraVideoRef} autoPlay playsInline muted className="profile-camera-video"/>
        {cameraError && <p className="profile-camera-error">{cameraError}</p>}
        <div className="profile-camera-actions"><button className="white-button" onClick={()=>stopProfileCamera('profile-photo')}>취소</button><button className="blue-button" onClick={captureProfileCamera}>촬영하기</button></div>
      </div></div>}
      {modal === 'feedback-success' && <div className="screen-dimmer"><div className="simple-dialog"><div className="simple-dialog-icon"><Check size={24}/></div><h2>등록이 완료되었습니다.</h2><p>작성한 리뷰를 확인하시겠습니까?</p><div className="dialog-actions"><button className="dialog-light" onClick={closeSuccess}>아니요</button><button className="dialog-dark" onClick={goMyPageAfterReview}>마이페이지로</button></div></div></div>}
      {modal === 'review-success' && <div className="screen-dimmer"><div className="simple-dialog"><div className="simple-dialog-icon"><Check size={24}/></div><h2>등록이 완료되었습니다.</h2><p>작성한 리뷰를 확인하시겠습니까?</p><div className="dialog-actions"><button className="dialog-light" onClick={closeSuccess}>아니요</button><button className="dialog-dark" onClick={goMyPageAfterReview}>마이페이지로</button></div></div></div>}
    </AppFrame>
  );
}

function AppFrame({ children, app=false }) {
  return (
    <div className={`app-background ${app?'app-background-main':''}`}>
      <div className="device-frame">{children}<div className="home-indicator"/></div>
      <button
        type="button"
        className="demo-reset-button"
        onClick={() => {
          const confirmed = window.confirm(
            '현재 시연에서 입력한 지역, 설문, 닉네임, 프로필 사진, 리뷰를 초기화하고 첫 화면으로 돌아갈까요?\n\nSupabase에 저장된 이전 리뷰 원본은 삭제하지 않습니다. 새 시연 세션에서는 이전 리뷰와 피드백 보정값이 표시되지 않습니다.'
          );
          if (!confirmed) return;
          try {
            Object.keys(window.localStorage).forEach((key) => {
              if (key.startsWith('wearther_')) window.localStorage.removeItem(key);
            });
            Object.keys(window.sessionStorage).forEach((key) => {
              if (key.startsWith('wearther_')) window.sessionStorage.removeItem(key);
            });
          } catch (error) {
            window.alert('브라우저 저장 데이터를 초기화하지 못했습니다. 브라우저 설정에서 사이트 데이터를 확인해주세요.');
            return;
          }
          window.location.reload();
        }}
        aria-label="처음부터 다시 시연하기"
        title="처음부터 다시 시연하기"
      >
        <RotateCcw size={14}/><span>처음부터 다시 시연</span>
      </button>
    </div>
  );
}
function GoogleMark() { return <span className="google-mark">G</span>; }
function PageHeader({ title, onBack }) {
  return <header className="subpage-header"><button className="back-icon" onClick={onBack}><ArrowLeft size={22}/></button><h1>{title}</h1><span/></header>;
}
function BottomNav({ active, onHome, onRecommend, onMyPage }) {
  return <nav className="bottom-tab-bar">
    <button className={active==='home'?'active':''} onClick={onHome}><House size={23} fill={active==='home'?'currentColor':'none'}/><span>홈</span></button>
    <button className={active==='recommend'?'active':''} onClick={onRecommend}><Shirt size={23} fill={active==='recommend'?'currentColor':'none'}/><span>오늘의 추천</span></button>
    <button className={active==='mypage'||active==='reviews'?'active':''} onClick={onMyPage}><UserRound size={23} fill={active==='mypage'||active==='reviews'?'currentColor':'none'}/><span>마이페이지</span></button>
  </nav>;
}
function LocationPicker({ query, setQuery, results, searching, selected, setSelected, locating, onCurrent, onApply, onClose, error, buttonLabel='변경', initial=false }) {
  return <div className="location-sheet-backdrop" onMouseDown={(e)=>{if(e.target===e.currentTarget)onClose();}}>
    <section className="location-picker-sheet">
      <div className="sheet-handle"/>
      <div className="location-sheet-heading"><h2>내 위치 선택</h2><button onClick={onClose} aria-label="닫기"><X size={23}/></button></div>
      <label className="location-search-box"><Search size={20}/><input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="동, 읍, 면으로 검색해보세요"/></label>
      <button className="current-location-button" onClick={onCurrent} disabled={locating}><MapPin size={15}/>{locating?'현재 위치 확인 중...':'현재 위치로 설정하기'}</button>
      <div className="region-result-list">
        {searching && <div className="region-result-placeholder">검색 중이에요</div>}
        {!searching && query.trim() && results.length===0 && <div className="region-result-placeholder">검색 결과가 없어요. 다른 지역명을 입력해보세요.</div>}
        {!query.trim() && !selected && <div className="region-result-placeholder">주소를 검색해주세요</div>}
        {!searching && results.map((item,i)=><button key={`${item.id||item.label||i}`} className={`region-result-row ${selected?.id===item.id?'selected':''}`} onClick={()=>setSelected(item)}>
          <span><b>{regionTextForSearch(item)}</b>{item.zone&&<small>{item.zone.replace('_',' · ')}</small>}</span>{selected?.id===item.id&&<Check size={18}/>}
        </button>)}
      </div>
      {selected && <div className="selected-region-summary"><MapPin size={14}/>{regionTextForSearch(selected)}</div>}
      {error && <p className="inline-error picker-error">{error}</p>}
      <button className="picker-apply-button" disabled={!selected} onClick={onApply}>{buttonLabel}</button>
    </section>
  </div>;
}
function WeatherSummary({ weather, snapshot, onRegion, detailed=false }) {
  return <section className={`weather-summary-card ${detailed?'is-detailed':''}`}>
    <button className="weather-summary-location" onClick={onRegion}><MapPin size={15} fill="currentColor"/>{shortRegion(snapshot.region)}<ChevronDown size={12}/></button>
    <div className="weather-summary-main"><div><strong>{Math.round(Number(weather.temp)||0)}°C</strong><span>{weather.condition || weatherText(weather.conditionCode)} · 체감 {Math.round(Number(snapshot.effectiveTemp)||0)}°C</span></div><WeatherMark code={weather.conditionCode||'sun'} size={67}/></div>
    <div className="weather-summary-divider"/>
    <div className="weather-summary-metrics"><div><span>최고 / 최저</span><b>{Math.round(Number(weather.max)||0)}° / {Math.round(Number(weather.min)||0)}°</b></div><div><span>습도</span><b>{weather.humidity==null?'—':`${weather.humidity}%`}</b></div><div><span>풍속</span><b>{weather.wind==null?'—':`${weather.wind} m/s`}</b></div><div><span>강수확률</span><b>{weather.precipitation==null?'—':`${weather.precipitation}%`}</b></div></div>
  </section>;
}
function ReviewCompact({ review, nickname, region }) {
  return <article className="recommend-review-card"><div className="review-avatar-dot"/><div className="recommend-review-copy"><small>Team {({cold:'추위',normal:'보통',hot:'더위'})[readJson(PROFILE_KEY)?.thermal] || 'WEARther'}, {review.region || regionDisplay(region)}</small><p><b>{nickname}</b> {LABELS[review.feedback] || '리뷰'} {review.comment ? `· ${review.comment}` : ''}</p></div></article>;
}
