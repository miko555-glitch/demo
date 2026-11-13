(() => {
  'use strict';
  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  let W = 1280;
  const H = 720;
  const BG_SCALE = H / 354;
  const WORLD_W = 1536 * BG_SCALE;
  const FLOOR_Y = 280 * BG_SCALE;
  ctx.imageSmoothingEnabled = false;

  function resizeCanvas(){
    const rect=canvas.getBoundingClientRect();
    if(!rect.width||!rect.height)return;
    const nextW=Math.max(700,Math.round(H*(rect.width/rect.height)));
    if(nextW!==W||canvas.height!==H){W=nextW;canvas.width=W;canvas.height=H;ctx.imageSmoothingEnabled=false;}
  }

  const $ = (id) => document.getElementById(id);
  const asset = (path) => (window.INLINE_ASSETS && window.INLINE_ASSETS[path]) ? window.INLINE_ASSETS[path] : `assets/${path}`;
  const images = {};
  const imagePaths = { panorama: 'backgrounds/farm_playable_bg.png' };

  function loadImage(key, path) {
    const img = new Image(); img.src = asset(path); images[key] = img;
    return new Promise((resolve) => { img.onload = () => resolve(img); img.onerror = () => resolve(null); });
  }

  const frameFiles = (prefix, count) => Array.from({length:count},(_,i)=>asset(`characters/${prefix}_${i+1}.png`));
  const frameSets = {
    idle: frameFiles('salah_idle',5),
    walk: frameFiles('salah_walk',6),
    run: frameFiles('salah_run',5),
    seshatIdle: frameFiles('seshat_idle',4),
    seshatFollow: frameFiles('seshat_follow',4)
  };
  const loadedFrames = {};
  function loadFrameSet(key, urls) {
    loadedFrames[key] = urls.map(src => { const img=new Image(); img.src=src; return img; });
  }
  Object.entries(frameSets).forEach(([key,urls])=>loadFrameSet(key,urls));

  let cameraX = 0, lastTime = 0, paused = false, modalOpen = false;
  const player = { x: 325*BG_SCALE, facing:1, moving:false, running:false, frame:0, frameClock:0, lastKind:'idle' };
  const seshat = { active:false, frame:0, clock:0 };
  const input = { left:false, right:false, run:false };
  const discovered = new Set();
  const journal = [];
  const puzzleState = {
    soil: { north: false, south: false, solved: false },
    boundary: { solved: false }
  };
  const evidenceItems = new Set();
  const chapterFlow = { day: 1, time: 'MORNING', introDone: false, fieldReflectionSeen: false, photographMarkSeen: false, mirrorSceneSeen: false, mirrorInspected: false, boundaryMarkSeen: false, daySixRecordSeen: false, finished: false };
  let cinematicState = null;
  let soilFeedback = '';
  let boundaryFeedback = '';
  let activeZone = null;

  // Positions are mapped to the original 1536px panorama, then scaled to the 720px game canvas.
  const zones = [
    {id:'field',x:445*BG_SCALE,name:'THE SOUTHERN FIELD',label:'FIELD',type:'CLUE 01 · CROPS',text:'The plants are thinner here than in the northern plot. Their color alone cannot tell me what is wrong. I need to compare the soil and water before writing anything down.',note:'The southern crop is visibly weaker. Appearance alone is not enough to identify the cause; the soil and irrigation need to be checked.',objective:'Compare the two agricultural plots.'},
    {id:'boundary',x:785*BG_SCALE,name:'THE OLD BOUNDARY',label:'BOUNDARY STONE',type:'CLUE 02 · LAND RECORD',text:'These stones do not sit in a straight line. One marker is older than the wall around it. I should compare its position with the measurement in Father’s notebook.',note:'The boundary stones do not align with the newer wall. One marker appears older than the surrounding construction.',objective:'Find the old boundary marker.'},
    {id:'channel',x:1195*BG_SCALE,name:'THE IRRIGATION CHANNEL',label:'IRRIGATION',type:'CLUE 03 · WATER',text:'The water slows near the bend. There is sediment caught between the stones. The upper channel may be carrying more water than this field receives.',note:'Water flow slows near the bend; sediment is collecting between the channel stones.',objective:'Trace the irrigation flow.'},
    {id:'wheel',x:1070*BG_SCALE,name:'THE WATER WHEEL',label:'WATER WHEEL',type:'CLUE 04 · EQUIPMENT',text:'The wheel turns, but the rhythm is uneven. I should check the channel before assuming the pump is the problem.',note:'The water wheel turns unevenly. Its behavior should be compared with the flow in the irrigation channel.',objective:'Check the water wheel.'},
    {id:'house',x:1410*BG_SCALE,name:'THE FARM HOUSE',label:'FARM HOUSE',type:'RECORD · FAMILY',text:'Father’s notebook should be inside. The old measurements may explain why the boundary stones do not match the wall.',note:'The family notebook contains the older land measurements. It needs to be compared with the stone marker.',objective:'Read the family measurement record.'}
  ];

  function drawBackground() {
    ctx.fillStyle='#30263a';ctx.fillRect(0,0,W,H);
    const img=images.panorama;
    if(img?.complete&&img.naturalWidth){
      ctx.drawImage(img,-cameraX,0,WORLD_W,H);
    }else{
      const g=ctx.createLinearGradient(0,0,0,H);g.addColorStop(0,'#f0a0a2');g.addColorStop(.6,'#755078');g.addColorStop(1,'#2a2836');ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
    }
  }

  function drawMarkers() {
    for(const z of zones){
      const x=z.x-cameraX;if(x<-80||x>W+80)continue;
      const found=discovered.has(z.id), pulse=.5+Math.sin(performance.now()/380+z.x)*.5;
      ctx.save();ctx.translate(x,FLOOR_Y-57);
      ctx.globalAlpha=found?.42:(.52+pulse*.25);
      ctx.strokeStyle=found?'#9bd1a8':'#f4d89c';ctx.lineWidth=2;
      ctx.beginPath();ctx.arc(0,0,9+pulse*3,0,Math.PI*2);ctx.stroke();
      ctx.fillStyle=found?'#9bd1a8':'#f4d89c';ctx.beginPath();ctx.moveTo(0,-5);ctx.lineTo(5,0);ctx.lineTo(0,5);ctx.lineTo(-5,0);ctx.closePath();ctx.fill();
      ctx.restore();
    }
  }

  function drawPlayer() {
    const kind=player.moving?(player.running?'run':'walk'):'idle';
    const frames=loadedFrames[kind];
    if(frames?.length){
      const frame=frames[player.frame%frames.length];
      if(frame.complete&&frame.naturalWidth){
        const scale=2.8,dw=frame.naturalWidth*scale,dh=frame.naturalHeight*scale;
        ctx.save();
        if(player.facing<0){ctx.translate(player.x-cameraX,0);ctx.scale(-1,1);ctx.drawImage(frame,-dw/2,FLOOR_Y-dh,dw,dh);}
        else ctx.drawImage(frame,player.x-cameraX-dw/2,FLOOR_Y-dh,dw,dh);
        ctx.restore();
      }
    }
    if(seshat.active){
      const arr=loadedFrames.seshatFollow||loadedFrames.seshatIdle;
      const f=arr?.[seshat.frame%arr.length];
      const spiritX=player.x-player.facing*112;
      const spiritY=FLOOR_Y-184+Math.sin(performance.now()/270)*7;
      if(f?.complete&&f.naturalWidth){
        const dw=f.naturalWidth*3,dh=f.naturalHeight*3;
        const glow=ctx.createRadialGradient(spiritX-cameraX,spiritY,3,spiritX-cameraX,spiritY,80);
        glow.addColorStop(0,'rgba(74,225,255,.3)');glow.addColorStop(1,'rgba(74,225,255,0)');
        ctx.fillStyle=glow;ctx.fillRect(spiritX-cameraX-85,spiritY-85,170,170);
        ctx.drawImage(f,spiritX-cameraX-dw/2,spiritY-dh/2,dw,dh);
      }
    }
  }

  function draw() {
    ctx.imageSmoothingEnabled=false;
    drawBackground();
    drawMarkers();
    drawPlayer();
    const edge=ctx.createLinearGradient(0,0,0,H);edge.addColorStop(0,'rgba(12,9,17,.06)');edge.addColorStop(.78,'rgba(12,9,17,0)');edge.addColorStop(1,'rgba(12,9,17,.16)');
    ctx.fillStyle=edge;ctx.fillRect(0,0,W,H);
  }

  const dayCopy = {
    1: ['DAY 01 · MORNING','MARK · POINT'],
    2: ['DAY 02 · AFTERNOON','MARK · LINE'],
    3: ['DAY 03 · LATE AFTERNOON','MARK · BRANCHES'],
    4: ['DAY 04 · NIGHT','MARK · REFLECTION'],
    5: ['DAY 05 · MORNING','MARK · RECORD'],
    6: ['DAY 06 · DUSK','MARK · MEASURE'],
    7: ['DAY 07 · NIGHT','MARK · CLOSING LINE']
  };
  function setDay(day, time) {
    chapterFlow.day = day;
    if(time) chapterFlow.time = time;
    const copy = dayCopy[day] || dayCopy[1];
    $('dayText').textContent = time ? `DAY ${String(day).padStart(2,'0')} · ${time}` : copy[0];
    $('markStage').textContent = copy[1];
    updateUI();
    saveGame();
  }

  function updateUI() {
    $('journalCount').textContent=journal.length;
    const steps=[chapterFlow.introDone,puzzleState.soil.solved,discovered.has('channel'),puzzleState.boundary.solved,chapterFlow.finished];
    const count=steps.filter(Boolean).length;
    $('progressText').textContent=`${count} / 5 CHAPTER BEATS`;
    $('progressFill').style.width=`${count/5*100}%`;
    let objective='The family photograph is in the archive. Investigate the weaker field.';
    if(!puzzleState.soil.solved) objective='Compare the northern and southern plots.';
    else if(!discovered.has('channel')) objective='Trace the irrigation channel and watch the water flow.';
    else if(!discovered.has('boundary')||!discovered.has('house')) objective='Find the old boundary marker and Father’s notebook.';
    else if(!puzzleState.boundary.solved) objective='Compare the old stone measurement with Father’s notebook.';
    else if(!chapterFlow.finished) objective='Return to the weakened irrigation bank after dusk.';
    else objective='Salah’s notebook survives. Chapter One is closed.';
    $('objectiveText').textContent=objective;
    activeZone=chapterFlow.finished?null:(zones.find(z=>Math.abs(z.x-player.x)<115)||null);
    $('interactionPrompt').classList.toggle('visible',!!activeZone);
    $('interactionPrompt').textContent=activeZone?`E · INVESTIGATE ${activeZone.label}`:'E · INVESTIGATE';
    $('interactBtn').disabled=!activeZone||chapterFlow.finished;
    if($('dayText')) $('dayText').textContent=dayCopy[chapterFlow.day]?.[0] || 'DAY 01 · MORNING';
    if($('markStage')) $('markStage').textContent=dayCopy[chapterFlow.day]?.[1] || 'MARK · POINT';
  }

  function setDialogue(speaker,text){$('speaker').textContent=speaker;$('dialogueText').textContent=text;}
  function addJournalEntry(title,type,note){
    if(!journal.some(e=>e.title===title)) journal.push({title,type,note});
  }

  function playSequence(cards, onComplete) {
    cinematicState = { cards, index: 0, onComplete };
    paused = true; modalOpen = true;
    $('cinematic').classList.add('open');
    $('cinematic').setAttribute('aria-hidden','false');
    renderCinematicCard();
  }

  function renderCinematicCard() {
    if(!cinematicState) return;
    const card = cinematicState.cards[cinematicState.index];
    const root = $('cinematic');
    $('cinematicBackdrop').style.backgroundImage = `linear-gradient(90deg,rgba(8,6,12,.88),rgba(8,6,12,.48)),url("${asset('backgrounds/1986_original_panorama.png')}")`;
    root.dataset.scene = card.scene || 'field';
    root.classList.toggle('cinematic-final',!!card.final);
    $('cineEyebrow').textContent = card.eyebrow || 'THE 21ST MEASURE';
    $('cineTitle').textContent = card.title || '';
    $('cineBody').textContent = card.body || '';
    $('cineSpeaker').textContent = card.speaker || '';
    $('cineLine').textContent = card.line || '';
    $('cineDialogue').style.display = card.line ? 'block' : 'none';
    $('cineStep').textContent = `${String(cinematicState.index+1).padStart(2,'0')} / ${String(cinematicState.cards.length).padStart(2,'0')}`;
    $('cineContinue').innerHTML = cinematicState.index===cinematicState.cards.length-1 ? 'CONTINUE <b>›</b>' : 'CONTINUE <b>›</b>';
  }

  function continueCinematic() {
    if(!cinematicState) return;
    cinematicState.index++;
    if(cinematicState.index < cinematicState.cards.length) {
      renderCinematicCard();
      return;
    }
    const done = cinematicState.onComplete;
    cinematicState = null;
    $('cinematic').classList.remove('open');
    $('cinematic').setAttribute('aria-hidden','true');
    modalOpen = false; paused = false;
    if(done) done();
    updateUI(); saveGame();
  }

  const prologueCards = [
    {scene:'ancient',eyebrow:'ANCIENT HELIOPOLIS-INSPIRED FIELDS · DUSK',title:'THE UNWRITTEN BOUNDARY',body:'A measuring rope crosses the fields and canals. Henu measures the land twice. The second measurement is correct. He looks toward his frightened family, then moves the boundary stone and changes the number in the ledger. A blue light appears in the ink.',speaker:'HENU',line:'“I am changing one line. I am saving a family.”'},
    {scene:'ancient',eyebrow:'THE ALTERED LEDGER',title:'A LINE THAT DOES NOT BELONG',body:'The reed pen stops. A seven-pointed mark appears in the dust. The stolen field becomes the original wound, and a fragment of the blue spirit is bound to the altered page. The stone door closes. The family name remains unknown.',speaker:'SESHAT',line:'“A line does not belong to the hand that writes it.”'},
    {scene:'ancient',eyebrow:'TITLE SEQUENCE',title:'THE 21ST MEASURE',body:'The sound of a reed pen scratching becomes the sound of water moving through an irrigation channel. A line of ink becomes a line in the earth. One record has been changed. Its consequences have not ended.',speaker:'',line:''}
  ];

  const firstPhotographCards = [
    {scene:'photo',eyebrow:'INT. EL-RAWI HOUSE · CAIRO OUTSKIRTS · MORNING, 1986',title:'THE FIRST PHOTOGRAPH',body:'A hand places a worn family photograph on a wooden table. Salah’s face comes into focus; the fields outside remain soft behind him. The calendar shows his twenty-first birthday. As Salah prepares to leave for the farm, his mother notices a faint grey point below his left eye and says nothing.',speaker:'SALMA',line:'“You have your father’s eyes.”'},
    {scene:'photo',eyebrow:'THE FAMILY FARM · 1986',title:'A FAMILIAR HABIT',body:'Salah takes his field notebook and measuring tool. He is not investigating a curse. He only wants to understand why one part of the family farm has become less productive.',speaker:'SALAH',line:'“And his terrible habit of measuring everything.”'},
    {scene:'photo',eyebrow:'PLAYER CONTROL · DAY ONE',title:'THE FARM BEFORE SUNSET',body:'The family photograph is added to the archive. Inspect the fields, follow the irrigation, and record what the land actually shows. Do not guess at a cause from crop colour alone.',speaker:'SALAH · FIELD NOTE',line:'“The southern field has been losing colour for weeks. Father says the water is fine. I should check the land myself.”'}
  ];

  function startChapterIntro() {
    playSequence(prologueCards, () => {
      playSequence(firstPhotographCards, () => {
        chapterFlow.introDone = true;
        evidenceItems.add('Family photograph');
        addJournalEntry('THE FIRST PHOTOGRAPH','ARCHIVE ITEM · 1986','A worn family photograph from the El-Rawi house. The calendar confirms Salah has turned twenty-one. A faint grey point is visible below his left eye.');
        setDay(1,'MORNING');
        setDialogue('SALAH','The southern field has been losing colour for weeks. Father says the water is fine. I should check the land myself.');
        saveGame(); updateUI();
      });
    });
  }

  function showPatchReflection() {
    if(chapterFlow.fieldReflectionSeen) return;
    chapterFlow.fieldReflectionSeen = true;
    seshat.active = true;
    evidenceItems.add('Blue spirit reflection');
    addJournalEntry('THE PATCH THAT CHANGED','CUTSCENE 03 · LATE AFTERNOON','One patch of plants is visibly weaker. Salah compares soil and water conditions. A small blue figure appears in the reflection of a metal water bowl and points toward the old boundary stone, not the crop.');
    const cards = [
      {scene:'reflection',eyebrow:'EXT. FAMILY FIELD · LATE AFTERNOON, 1986',title:'THE PATCH THAT CHANGED',body:'A low view follows the row of plants. One patch is visibly weaker. The camera pauses on soil clods and a cracked irrigation edge. Salah checks the channel and compares the two samples.',speaker:'SALAH',line:'“You are not a bird. You are not smoke. What are you?”'},
      {scene:'reflection',eyebrow:'A REFLECTION IN THE WATER',title:'THE BLUE GUIDE',body:'A small blue figure appears briefly in the reflection of a metal water bowl. It sends a silent pulse of light and points toward the old boundary stone, not toward the weaker crop. Then the reflection breaks.',speaker:'SPIRIT',line:'[A silent pulse of blue light.]'}
    ];
    playSequence(cards,()=>{
      seshat.active = false;
      setDay(3,'LATE AFTERNOON');
      chapterFlow.photographMarkSeen = true;
      addJournalEntry('DAY 03 — THE MARK IN THE PHOTOGRAPH','FACIAL GLYPH · BRANCHES','A branching grey-blue mark is now visible below Salah’s left eye in the family photograph. The pattern is easy to mistake for a flaw in the old print.');
      evidenceItems.add('Photograph with the first facial glyph');
      playSequence([
        {scene:'photo',eyebrow:'EL-RAWI HOUSE · DAY THREE',title:'THE PHOTOGRAPH HAS CHANGED',body:'The same photograph is examined again. The grey-blue point has become a fine branching line. The mark is visible in the photograph even when Salah’s face is still turned away from the light.',speaker:'SALAH · JOURNAL',line:'“Was that line there before?”'},
        {scene:'mirror',eyebrow:'INT. SALAH’S ROOM · NIGHT, DAY FOUR',title:'THE LINE ON THE FACE',body:'Salah looks into a mirror. A thin line sits below his left eye. In the mirror only, it briefly resembles a canal wall. He rubs the mark and checks it again. It does not move.',speaker:'SALAH',line:'“Perhaps the dust. Perhaps the sun.”'},
        {scene:'mirror',eyebrow:'FROM THE NEXT ROOM',title:'COME INSIDE',body:'A pen scratch carries into the next scene. The mark is still small, but the reflection has begun to echo the boundary line.',speaker:'SALMA · OFF',line:'“Come inside. It is late.”'}
      ],()=>{
        chapterFlow.mirrorSceneSeen = true;
        setDay(4,'NIGHT');
        addJournalEntry('DAY 04 — THE MIRROR LINE','FACIAL GLYPH · REFLECTION','A thin line sits below Salah’s left eye. In the mirror only, it briefly resembles a canal wall. Salah records it as “strange mark”. This is not a diagnosis.');
        setDialogue('SALAH','Perhaps the dust. Perhaps the sun.');
      });
    });
  }

  function showBoundaryMarkBeat() {
    if(chapterFlow.boundaryMarkSeen) return;
    chapterFlow.boundaryMarkSeen = true;
    setDay(5,'MORNING');
    addJournalEntry('DAY 05 — THE RECORD TAKES SHAPE','FACIAL GLYPH · GEOMETRY','The mark now resembles part of a larger geometry. The tiny symbol on the boundary stone appears to share its angles, but the connection is not yet understood.');
    setDialogue('SALAH','This mark is beginning to look like the line on the stone. I need the notebook before I decide what that means.');
  }

  function showDaySixBeat() {
    if(chapterFlow.daySixRecordSeen) return;
    chapterFlow.daySixRecordSeen = true;
    setDay(6,'DUSK');
    evidenceItems.add('Three repeated boundary sketches');
    addJournalEntry('DAY 06 — THE SAME SYMBOL THREE TIMES','FACIAL GLYPH · MEASURE','By day six, Salah has drawn the same boundary symbol three times without knowing why. He adds one sentence to his notebook: “The line on the stone is older than the wall.” The glyph is nearly complete.');
    playSequence([
      {scene:'field',eyebrow:'INT. SALAH’S ROOM · DUSK, DAY SIX',title:'THREE LINES',body:'The notebook shows the same boundary symbol in three separate places. Salah has no memory of deciding to draw it. The third sketch is darker than the first two.',speaker:'SALAH · NOTEBOOK',line:'“The line on the stone is older than the wall.”'},
      {scene:'field',eyebrow:'THE SIXTH MEASURE',title:'A NEARLY COMPLETE GLYPH',body:'The mark below Salah’s left eye has almost completed its geometry. It resembles the old canal boundary, but it offers no explanation and no warning that Salah can understand.',speaker:'',line:''}
    ],()=>setDialogue('SALAH','The line on the stone is older than the wall. I need to see the bank again, tonight.'));
  }

  function finishSalahChapter() {
    if(chapterFlow.finished) return;
    setDay(7,'NIGHT');
    addJournalEntry('DAY 07 — THE CLOSING LINE','FACIAL GLYPH · COMPLETE','The seven-day mark reaches its complete form. Its geometry resembles the weakened canal wall. Salah does not understand it as a warning.');
    const cards = [
      {scene:'night',eyebrow:'EXT. IRRIGATION BANK · NIGHT, DAY SEVEN',title:'THE SEVENTH EVENING',body:'The canal is almost black. Salah’s lantern moves across the water. The seven-pointed reflection appears, holds for a breath, then breaks into the current.',speaker:'SALAH',line:'“The stone was moved. I know it was moved.”'},
      {scene:'night',eyebrow:'THE BANK GIVES WAY',title:'THE LAST MEASUREMENT',body:'As Salah checks the weakened section, the irrigation bank gives way. The camera cuts before impact. No body is shown. The sound of the water fills the frame.',speaker:'DIRECTION',line:'[No answer.]'},
      {scene:'night',eyebrow:'AFTER THE WATER SETTLES',title:'THE NOTEBOOK SURVIVES',body:'The measuring rod is trapped between two stones. Salah’s notebook lies open nearby. A final page is added to the family archive. The first marked heir is gone; the record remains.',speaker:'ARCHIVE',line:'FIRST DEATH · SALAH EL-RAWI · 1986',final:true},
      {scene:'night',eyebrow:'CHAPTER ONE COMPLETE',title:'THE FIRST MEASURE',body:'The chapter closes on the abandoned measuring rod and the open notebook. The sound of water becomes rainfall, carrying the story toward another country and another heir.',speaker:'',line:'THE NOTEBOOK REMAINS.' ,final:true}
    ];
    playSequence(cards,()=>{
      chapterFlow.finished = true;
      seshat.active = false;
      evidenceItems.add('Salah’s abandoned measuring rod');
      evidenceItems.add('Salah’s notebook · final page');
      addJournalEntry('THE SEVENTH EVENING','CHAPTER END · FIRST DEATH','The irrigation bank gave way during Salah’s night inspection. The camera cut before impact. His measuring rod was left trapped between two stones, and his notebook remained open.');
      setDialogue('ARCHIVE','Salah El-Rawi, age twenty-one. First documented death. The notebook survives.');
      $('worldStatus').textContent='CHAPTER ONE · CLOSED';
      updateUI(); saveGame();
    });
  }

  function investigate(){
    if(chapterFlow.finished){setDialogue('ARCHIVE','This chapter has ended. Salah’s notebook is preserved in the family archive.');return;}
    if(!activeZone){setDialogue('SALAH','I should get closer to something worth examining.');return;}
    const z=activeZone;

    if(z.id==='boundary' && chapterFlow.day<4){
      setDialogue('SALAH','The field and the water come first. I should follow what I saw in the basin before examining the old boundary.');
      return;
    }

    if(z.id==='channel' && chapterFlow.day>=6 && puzzleState.boundary.solved){
      finishSalahChapter();
      return;
    }

    if(z.id==='field'){
      if(!discovered.has('field')){
        discovered.add('field');
        addJournalEntry(z.name,z.type,z.note);
        setDialogue('SALAH','The southern crop is weaker. I need to compare the two plots before I decide why.');
      }
      $('worldStatus').textContent=z.name;
      updateUI();saveGame();
      if(!puzzleState.soil.solved) openSoilPuzzle();
      else openSoilPuzzle(true);
      return;
    }

    if(z.id==='channel' && !discovered.has('channel')){
      discovered.add('channel');
      addJournalEntry(z.name,z.type,z.note);
      evidenceItems.add('Irrigation-flow observation');
      $('worldStatus').textContent=z.name;
      updateUI();saveGame();
      showPatchReflection();
      return;
    }

    if(!discovered.has(z.id)){
      discovered.add(z.id);
      addJournalEntry(z.name,z.type,z.note);
      if(z.id==='boundary'){
        evidenceItems.add('Old boundary marker');
        showBoundaryMarkBeat();
        setDialogue('SALAH','This measuring line is older than the wall. I should find the family record before drawing conclusions.');
      } else if(z.id==='house'){
        evidenceItems.add('Father’s notebook');
        addJournalEntry('FATHER’S FIELD NOTEBOOK','ARCHIVE ITEM · 1986','The notebook contains hand-drawn field measurements and a record of the family boundary. It can be compared with the old stone marker.');
        setDialogue('SALAH','The notebook has a boundary measurement. It may help me understand the old stone.');
      } else setDialogue('SALAH',z.text);
    } else if(z.id==='house' && !chapterFlow.mirrorInspected && chapterFlow.day>=4){
      chapterFlow.mirrorInspected=true;
      addJournalEntry('THE MIRROR AND THE STONE','OPTIONAL OBSERVATION · DAY FOUR','In the mirror, the mark briefly resembles the symbol on the boundary stone. The resemblance is recorded, but Salah does not yet understand it.');
      evidenceItems.add('Mirror observation');
      setDialogue('SALAH','The line in the mirror bends in the same place as the mark on the stone. I still do not know why.');
      saveGame();
    } else setDialogue('SALAH',z.text);

    $('worldStatus').textContent=z.name;
    updateUI();saveGame();
    if(discovered.has('boundary')&&discovered.has('house')&&!puzzleState.boundary.solved){
      openBoundaryPuzzle();
    }
  }

  function openSoilPuzzle(alreadyVisited=false){
    soilFeedback='';
    openModal('Two Plots, Two Conditions','FIELD INVESTIGATION · CLUE 01','');
    renderSoilPuzzle(alreadyVisited);
  }

  function renderSoilPuzzle(alreadyVisited=false){
    const north=puzzleState.soil.north;
    const south=puzzleState.soil.south;
    let content=`<p class="puzzle-intro">${alreadyVisited?'Salah’s comparison is recorded here. Review the samples or revisit the conclusion.':'The southern crop looks weaker, but appearance is not a diagnosis. Salah takes a closer look at both plots before deciding what to investigate next.'}</p>
      <div class="evidence-grid">
        <article class="evidence-card ${north?'checked':''}">
          <div class="soil-swatch soil-north"><i></i><i></i><i></i></div>
          <small> PLOT A · NORTHERN FIELD </small><h3>${north?'Observation recorded':'Unexamined sample'}</h3>
          <p>${north?'The surface is loose and darker. The sample breaks apart easily when pressed.':'Inspect the top layer and feel how the soil holds together.'}</p>
          ${north?'<span class="evidence-stamp">RECORDED</span>':'<button class="puzzle-btn" data-action="soil-north">EXAMINE PLOT A</button>'}
        </article>
        <article class="evidence-card ${south?'checked':''}">
          <div class="soil-swatch soil-south"><i></i><i></i><i></i></div>
          <small>PLOT B · SOUTHERN FIELD</small><h3>${south?'Observation recorded':'Unexamined sample'}</h3>
          <p>${south?'The surface forms a harder crust. The sample feels more compact than the northern plot.':'Inspect the weaker plot and compare its surface with Plot A.'}</p>
          ${south?'<span class="evidence-stamp">RECORDED</span>':'<button class="puzzle-btn" data-action="soil-south">EXAMINE PLOT B</button>'}
        </article>
      </div>`;
    if(north&&south&&!puzzleState.soil.solved){
      content+=`<div class="puzzle-question"><small>COMPARE YOUR OBSERVATIONS</small><h3>What can Salah reasonably conclude right now?</h3>
        <button class="answer-btn" data-action="soil-answer" data-answer="color">A. The crop color proves the plants have a disease.</button>
        <button class="answer-btn" data-action="soil-answer" data-answer="careful">B. The plots differ, but the cause needs more checks. I should inspect the irrigation before deciding.</button>
        <button class="answer-btn" data-action="soil-answer" data-answer="salt">C. The southern plot is definitely contaminated with salt.</button>
        ${soilFeedback?`<p class="puzzle-feedback">${soilFeedback}</p>`:''}
      </div>`;
    }
    if(puzzleState.soil.solved){
      content+=`<div class="puzzle-success"><b>FIELD COMPARISON COMPLETE</b><p>The two plots do not share the same surface condition. The difference is recorded, but Salah has not diagnosed the cause. The next step is to trace the water.</p><button class="puzzle-btn" data-action="close-puzzle">RETURN TO THE FARM</button></div>`;
    } else if(!(north&&south)){
      content+=`<p class="puzzle-hint">Examine both plots to unlock the comparison.</p>`;
    }
    $('modalContent').innerHTML=content;
  }

  function openBoundaryPuzzle(){
    boundaryFeedback='';
    openModal('The Old Line','LAND RECORD · EVIDENCE COMPARISON','');
    renderBoundaryPuzzle();
  }

  function renderBoundaryPuzzle(){
    const solved=puzzleState.boundary.solved;
    let content=`<p class="puzzle-intro">Salah now has two pieces of evidence. The old stone carries a weathered measuring line, while Father’s notebook records a different measurement for this boundary.</p>
      <div class="record-grid">
        <article class="record-card"><small>PHYSICAL EVIDENCE</small><h3>Old boundary stone</h3><p>The carved line appears older than the surrounding wall and does not align with its edge.</p><span class="record-mark">   OLD MARKER</span></article>
        <article class="record-card"><small>WRITTEN EVIDENCE</small><h3>Father’s notebook</h3><p>The recorded boundary measurement does not match the measurement indicated by the old stone.</p><span class="record-mark">NOTEBOOK · 1986</span></article>
      </div>`;
    if(!solved){
      content+=`<div class="puzzle-question"><small>INTERPRET THE EVIDENCE</small><h3>What does the mismatch establish?</h3>
        <button class="answer-btn" data-action="boundary-answer" data-answer="agree">A. The old marker and the notebook agree; the wall is only decorative.</button>
        <button class="answer-btn" data-action="boundary-answer" data-answer="mismatch">B. The old marker and the notebook disagree. The boundary needs further investigation.</button>
        <button class="answer-btn" data-action="boundary-answer" data-answer="intent">C. This proves Father deliberately changed the land record.</button>
        ${boundaryFeedback?`<p class="puzzle-feedback">${boundaryFeedback}</p>`:''}
      </div>`;
    }else{
      content+=`<div class="puzzle-success"><b>MEASUREMENT DISCREPANCY RECORDED</b><p>The stone and the notebook do not agree. Salah has found a contradiction, not yet its explanation.</p><button class="puzzle-btn" data-action="close-puzzle">RETURN TO THE FARM</button></div>`;
    }
    $('modalContent').innerHTML=content;
  }

  $('modalContent').addEventListener('click',(event)=>{
    const button=event.target.closest('[data-action]');
    if(!button)return;
    const action=button.dataset.action;
    if(action==='soil-north'){
      puzzleState.soil.north=true; evidenceItems.add('Northern plot observation');
      renderSoilPuzzle();saveGame();return;
    }
    if(action==='soil-south'){
      puzzleState.soil.south=true; evidenceItems.add('Southern plot observation');
      renderSoilPuzzle();saveGame();return;
    }
    if(action==='soil-answer'){
      if(button.dataset.answer==='careful'){
        puzzleState.soil.solved=true;
        evidenceItems.add('Paired soil observations');
        addJournalEntry('THE TWO PLOTS','PUZZLE SOLVED · SOIL COMPARISON','The northern sample is loose and darker; the southern sample forms a harder, more compact crust. The difference is real, but it does not identify the cause. The irrigation needs to be checked before reaching a diagnosis.');
        setDay(2,'AFTERNOON');
        addJournalEntry('DAY 02 — THE LINE','FACIAL GLYPH · LINE','The faint point below Salah’s left eye has lengthened into a fine line toward the cheekbone. Salah assumes it is dust or irritation.');
        setDialogue('SALAH','The southern soil is more compact. That is an observation, not an answer. I need to follow the water.');
        soilFeedback='';updateUI();saveGame();renderSoilPuzzle();
      }else{
        soilFeedback=button.dataset.answer==='color'?'Crop color alone cannot establish a disease. Compare the samples and check other conditions.':'That would be a diagnosis without enough evidence. Salah needs to test the water and soil before naming a cause.';
        renderSoilPuzzle();
      }
      return;
    }
    if(action==='boundary-answer'){
      if(button.dataset.answer==='mismatch'){
        puzzleState.boundary.solved=true;
        evidenceItems.add('Measurement discrepancy');
        addJournalEntry('THE LINE DOES NOT MATCH','PUZZLE SOLVED · BOUNDARY RECORD','The old boundary stone and Father’s notebook show different measurements. This establishes a discrepancy, but does not yet prove who changed the boundary or why.');
        setDialogue('SALAH','The measurements do not match. I need to understand when the wall was built, and why the older line was ignored.');
        boundaryFeedback='';updateUI();saveGame();renderBoundaryPuzzle();
        closeModal();
        showDaySixBeat();
      }else{
        boundaryFeedback=button.dataset.answer==='intent'?'The evidence proves a mismatch, not who caused it or whether it was deliberate.':'The two records disagree. Look again at what the stone and notebook actually show.';
        renderBoundaryPuzzle();
      }
      return;
    }
    if(action==='close-puzzle') closeModal();
  });

  function openModal(title,eyebrow,html){
    paused=true;modalOpen=true;
    $('modalTitle').textContent=title;$('modalEyebrow').textContent=eyebrow;$('modalContent').innerHTML=html;
    $('modal').classList.add('open');$('modal').setAttribute('aria-hidden','false');
  }
  function closeModal(){
    $('modal').classList.remove('open');$('modal').setAttribute('aria-hidden','true');modalOpen=false;paused=false;
  }
  function showJournal(){
    const html=journal.length?journal.map(e=>`<article class="entry"><small>${e.type}</small><h3>${e.title}</h3><p>${e.note}</p></article>`).join(''):'<div class="empty">No notes yet. Walk through the farm and investigate the marked places.</div>';
    openModal('Salah’s Journal','FIELD NOTES · 1986',html);
  }
  function showInventory(){
    const items=[['Field Notebook','Salah’s working notes and observations.'],['Measuring Tool','Used to inspect the old boundary marker.']];
    for(const item of evidenceItems) items.push([item,'Evidence recorded during the farm investigation.']);
    openModal('Inventory','CARRIED ITEMS & EVIDENCE',`<div class="inventory-grid">${items.map(([name,desc])=>`<div class="item"><strong>${name}</strong><span>${desc}</span></div>`).join('')}</div>`);
  }
  function showPause(){
    openModal('Paused',`THE FAMILY FARM · DAY ${String(chapterFlow.day).padStart(2,'0')}`, `<p class="pause-copy">The farm is quiet. The light is fading over the fields.</p><button class="top-btn" id="resumeBtn">RETURN TO THE FARM</button>`);
    $('resumeBtn').addEventListener('click',closeModal);
  }

  function saveGame(){
    try{localStorage.setItem('the21stmeasure_1986_complete_v4',JSON.stringify({x:player.x,discovered:[...discovered],journal,puzzleState,evidenceItems:[...evidenceItems],chapterFlow}));}catch(e){}
  }
  function restoreGame(){
    try{
      const data=JSON.parse(localStorage.getItem('the21stmeasure_1986_complete_v4')||'null');
      if(!data)return false;
      player.x=Math.max(100,Math.min(WORLD_W-100,Number(data.x)||325*BG_SCALE));
      (data.discovered||[]).forEach(id=>discovered.add(id));
      (data.journal||[]).forEach(e=>journal.push(e));
      (data.evidenceItems||[]).forEach(item=>evidenceItems.add(item));
      if(data.puzzleState){Object.assign(puzzleState.soil,data.puzzleState.soil||{});Object.assign(puzzleState.boundary,data.puzzleState.boundary||{});}
      if(data.chapterFlow) Object.assign(chapterFlow,data.chapterFlow);
      seshat.active=false;
      return true;
    }catch(e){return false;}
  }

  function animate(now){
    const dt=Math.min(.04,(now-lastTime)/1000||0);lastTime=now;
    if(!paused){
      const direction=(input.right?1:0)-(input.left?1:0);
      player.moving=direction!==0;player.running=player.moving&&input.run;
      if(direction){player.facing=direction;player.x+=direction*(player.running?335:215)*dt;player.x=Math.max(70,Math.min(WORLD_W-85,player.x));updateUI();}
      const kind=player.moving?(player.running?'run':'walk'):'idle';
      if(kind!==player.lastKind){player.frame=0;player.frameClock=0;player.lastKind=kind;}
      const frames=loadedFrames[kind], interval=player.running?92:(player.moving?138:230);
      player.frameClock+=dt*1000;
      if(player.frameClock>=interval){player.frame=(player.frame+1)%(frames?.length||1);player.frameClock=0;}
      if(seshat.active){seshat.clock+=dt*1000;if(seshat.clock>160){seshat.frame=(seshat.frame+1)%((loadedFrames.seshatFollow||[]).length||1);seshat.clock=0;}}
      const maxCamera=Math.max(0,WORLD_W-W);
      const target=Math.max(0,Math.min(maxCamera,player.x-W*.56));cameraX+=(target-cameraX)*Math.min(1,dt*5.5);
    }
    draw();requestAnimationFrame(animate);
  }

  function bindHold(id,key){
    const el=$(id);const down=(e)=>{e.preventDefault();input[key]=true;};const up=(e)=>{e.preventDefault();input[key]=false;};
    el.addEventListener('pointerdown',(e)=>{try{el.setPointerCapture(e.pointerId);}catch(_){}down(e);});
    ['pointerup','pointercancel','pointerleave','lostpointercapture'].forEach(t=>el.addEventListener(t,up));
  }
  bindHold('leftBtn','left');bindHold('rightBtn','right');bindHold('runBtn','run');
  $('interactBtn').addEventListener('pointerdown',(e)=>{e.preventDefault();investigate();});
  $('journalBtn').addEventListener('click',showJournal);$('inventoryBtn').addEventListener('click',showInventory);$('pauseBtn').addEventListener('click',showPause);
  $('closeModal').addEventListener('click',closeModal);$('modal').addEventListener('click',e=>{if(e.target===$('modal'))closeModal();});
  $('cineContinue').addEventListener('click',continueCinematic);
  $('dismissDialogue').addEventListener('click',()=>{ if(chapterFlow.finished){$('dialogueText').textContent='Salah’s notebook is preserved in the family archive.';} else if(chapterFlow.day>=6){$('dialogueText').textContent='The light is fading. The weakened irrigation bank needs one final inspection.';} else {$('dialogueText').textContent='I should record what I can observe, and leave the cause open until I have enough evidence.';} });

  document.addEventListener('keydown',(e)=>{
    const key=e.key.toLowerCase();
    if(['arrowleft','arrowright',' ','arrowup','arrowdown'].includes(key))e.preventDefault();
    if(key==='a'||key==='arrowleft')input.left=true;
    if(key==='d'||key==='arrowright')input.right=true;
    if(key==='shift')input.run=true;
    if(key==='e'||key==='enter'){if(!modalOpen)investigate();}
    if(key===' '&&cinematicState){e.preventDefault();continueCinematic();}
    if(key==='j'&&!modalOpen)showJournal();
    if(key==='i'&&!modalOpen)showInventory();
    if(key==='escape'){if(cinematicState)return;if(modalOpen)closeModal();else showPause();}
  });
  document.addEventListener('keyup',(e)=>{const key=e.key.toLowerCase();if(key==='a'||key==='arrowleft')input.left=false;if(key==='d'||key==='arrowright')input.right=false;if(key==='shift')input.run=false;});
  window.addEventListener('blur',()=>{input.left=input.right=input.run=false;});
  window.addEventListener('resize',resizeCanvas);
  window.addEventListener('pagehide',saveGame);setInterval(saveGame,5000);

  resizeCanvas();
  Promise.all(Object.entries(imagePaths).map(([k,p])=>loadImage(k,p))).then(()=>{
    resizeCanvas();
    const hasSave=restoreGame();
    if(!hasSave){
      chapterFlow.day=1;chapterFlow.introDone=false;
      $('dayText').textContent='DAY 01 · MORNING';$('markStage').textContent='MARK · POINT';
      updateUI();
      startChapterIntro();
    } else {
      updateUI();
      if(chapterFlow.finished){paused=true;setDialogue('ARCHIVE','Salah El-Rawi, age twenty-one. First documented death. The notebook survives.');}
    }
    requestAnimationFrame(animate);
  });
})();
