/* Every button keeps one SVG icon and a visible text label. */
(function(){
 const PATHS={
  close:'M6 6l12 12M18 6L6 18',
  filter:'M3 5h18l-7 8v6l-4-2v-4L3 5',
  write:'M4 20l4-1 12-12-3-3L5 16l-1 4M14 7l3 3',
  reset:'M4 11a8 8 0 1 1 2 7M4 4v7h7',
  clear:'M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7',
  connect:'M9 7v4M15 7v4M7 11h10v6a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2z',
  more:'M6 9l6 6 6-6',
  check:'M5 12l5 5L20 7',
  info:'M12 11v6M12 7h.01',
  text:'M4 6h16M4 12h10M4 18h14',
  hex:'M8 3h8l5 9-5 9H8L3 12z',
  sequence:'M8 6h13M8 12h13M8 18h13M4 6h.01M4 12h.01M4 18h.01',
  same:'M8 8h11v11H8zM5 5h11',
  power:'M12 3v8M6.5 7a7 7 0 1 0 11 0',
  controls:'M6 9l6 6 6-6',
  select:'M4 7h16M4 12h16M4 17h16',
  results:'M4 5h16v14H4zM8 9h8M8 13h5',
  generic:'M12 7a5 5 0 1 0 0 10a5 5 0 1 0 0-10'
 };
 function icon(path){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.8');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');svg.setAttribute('aria-hidden','true');svg.setAttribute('class','uiIcon');const shape=document.createElementNS('http://www.w3.org/2000/svg','path');shape.setAttribute('d',path);svg.append(shape);return svg;}
 function visibleText(button){const copy=button.cloneNode(true);copy.querySelectorAll('svg').forEach(node=>node.remove());return copy.textContent.replace(/\s+/g,' ').trim();}
 function shortLabel(button){const aria=(button.getAttribute('aria-label')||'').trim();if(/^close\b/i.test(aria))return 'Close';if(/reader control/i.test(aria))return 'Controls';return aria||'Button';}
 function iconFor(button){const id=button.id||'',blob=(id+' '+(button.getAttribute('aria-label')||'')+' '+visibleText(button)).toLowerCase();
  if(id==='readerControlsToggle'||/reader control|\bcontrols\b/.test(blob))return PATHS.controls;
  if(/close/.test(blob))return PATHS.close;
  if(id==='resetTagFilter'||/clear/.test(blob))return PATHS.clear;
  if(id==='openTagFilter'||id==='applyTagFilter'||/filter|show tags/.test(blob))return PATHS.filter;
  if(id==='factoryReset'||id==='startMultiReset'||/factory reset/.test(blob))return PATHS.reset;
  if(id==='connectReader'||/connect/.test(blob))return PATHS.connect;
  if(id==='readMoreTags'||id==='latestEvents'||id==='olderEvents'||/read more|latest|previous/.test(blob))return PATHS.more;
  if(button.dataset.encoding==='HEX'||/\bhex\b/.test(blob))return PATHS.hex;
  if(button.dataset.encoding==='ASCII'||/\btext\b/.test(blob))return PATHS.text;
  if(button.dataset.mode==='sequence'||id==='multiWriteFill'||/1, 2, 3|fill number/.test(blob))return PATHS.sequence;
  if(button.dataset.mode==='same'||/same data/.test(blob))return PATHS.same;
  if(id==='multiWriteAll'||/select visible|select this tag|deselect/.test(blob))return PATHS.select;
  if(id==='viewResetResults'||/view results/.test(blob))return PATHS.results;
  if(id==='modalDetailsTab'||id==='openTagInfo'||/\bdetails\b|information/.test(blob))return PATHS.info;
  if(id==='write'||id==='writeTags'||id==='startMultiWrite'||id==='modalWriteTab'||/write/.test(blob))return PATHS.write;
  if(button.closest('.powerPresets')||/\b(near|medium|far)\b/.test(blob))return PATHS.power;
  if(/^(ok|done)$/.test(visibleText(button).toLowerCase()))return PATHS.check;
  return PATHS.generic;
 }
 function isMark(text){return /^[\s×✕✖✘xX]+$/.test(text);}
 function decorate(button){if(!(button instanceof HTMLButtonElement))return;[...button.childNodes].forEach(node=>{if(node.nodeType===3&&isMark(node.textContent))node.remove();});const icons=[...button.querySelectorAll('svg')];icons.slice(1).forEach(node=>node.remove());const text=visibleText(button),hasIcon=!!button.querySelector('svg');if(hasIcon&&text&&!isMark(text))return;if(!text||isMark(text)){let span=[...button.children].find(el=>el.classList.contains('btnLabel'));if(!span){span=document.createElement('span');span.className='btnLabel';button.append(span);}if(!span.textContent||isMark(span.textContent))span.textContent=shortLabel(button);}if(!button.querySelector('svg'))button.prepend(icon(iconFor(button)));}
 function decorateSegment(span){if(!span||span.querySelector('svg'))return;span.prepend(icon(/HEX/i.test(span.textContent)?PATHS.hex:PATHS.text));}
 function decorateTree(root){if(!root||root.nodeType!==1)return;if(root instanceof HTMLButtonElement)decorate(root);root.querySelectorAll('button').forEach(decorate);root.querySelectorAll('.segments span').forEach(decorateSegment);}
 const bar=document.createElement('div');bar.className='feedActionBar';document.querySelector('.feed .panelhead').append(bar);
 for(const id of ['writeTags','openTagFilter','factoryReset','clearTagList']){const button=document.getElementById(id);if(button)bar.append(button);}
 const toggle=document.getElementById('readerControlsToggle');if(toggle){toggle.classList.add('readerControlsToggle');toggle.querySelector('svg')?.remove();}
 decorateTree(document.body);
 const observer=new MutationObserver(records=>{for(const record of records){if(record.type!=='childList')continue;if(record.target instanceof HTMLButtonElement)decorate(record.target);for(const node of record.addedNodes)decorateTree(node);}});
 observer.observe(document.body,{childList:true,subtree:true});
})();
