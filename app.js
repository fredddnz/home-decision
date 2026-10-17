import { API_ORIGIN } from './deployment-config.mjs?v=0.17.0';
import { createAPIClient } from './api-client.mjs?v=0.17.0';
import { ahpFailureExplanation } from './ahp-diagnostics.mjs?v=0.17.0';
import {riskExplanation,riskProbabilityLabel} from './risk-diagnostics.mjs?v=0.17.0';
import {monteCarloExplanation} from './monte-carlo-diagnostics.mjs?v=0.17.0';
import {inspectPDFPages} from './pdf-pages.mjs?v=0.17.0';
import {createScannedPDFSubmitter} from './pdf-upload.mjs?v=0.17.0';
const apiFetch = createAPIClient({ apiOrigin: API_ORIGIN });
const uploadLocalPDF = createScannedPDFSubmitter({apiOrigin:API_ORIGIN,fetchImpl:apiFetch});
const dataNotice = API_ORIGIN
  ? 'Only the address and geometry go to public property data providers. Your project, conversation and extracted document text are stored in Cloudflare D1 for up to 30 days. Relevant excerpts are processed by Cloudflare Workers AI for the six analysis roles, subject to the free daily allowance. Original PDFs stay in your browser; only readable extracted text is submitted. Confirmed blank pages retain their page numbers. Scanned or unresolved image pages stop locally because online OCR is unavailable; their original PDF is not uploaded. Projects are private to this browser session; opening the website on another device starts a separate session.'
  : 'Only the address and geometry go to public data providers. Source excerpts, your expected price and relevant notes are processed by OpenAI through the locally signed-in Codex CLI for AI analysis. This uses your existing Codex quota; raw files are not uploaded.';
const $ = id => document.getElementById(id);
if (API_ORIGIN) {
  $('about-app').textContent = 'This is an online, interactive MVP. “Example address, Auckland” uses synthetic information. Real addresses trigger public property checks followed by six source-bound AI analysis roles. Open a category or purchase support status for results.';
  $('about-data').textContent = dataNotice;
  $('delete-explanation').textContent = 'This removes its saved notes, extracted documents and calculations from the online preview.';
}
const money = cents => new Intl.NumberFormat('en-NZ', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 }).format(cents / 100);
const dateLabel = value => new Intl.DateTimeFormat('en-NZ', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Pacific/Auckland' }).format(new Date(value));
const dateOnly = value => new Intl.DateTimeFormat('en-NZ', { dateStyle: 'medium', timeZone: 'Pacific/Auckland' }).format(new Date(value));
let project = null;
let busy = false;
let researching = false;
let researchProjectId = null;
let detailView = 'support';
let analysisTimer = null;
let analysisStarting = false;
let analysisPollingId = null;
let researchPollingId = null;
const researchRequests=new Set();
const documentPolls=new Set();
let addressTimer=null,addressController=null,addressGeneration=0,addressOptions=[],activeAddress=-1;
const states = { provisional: 'Provisional', insufficient: 'Needs evidence', clarification: 'Clarify budget', over_budget: 'Over budget', needs_review: 'Needs review', conflict: 'Review inputs', finance_hold: 'Finance limit',not_for_sale:'Listing inactive' };
const explanations = {
  not_for_sale:'The checked agency page is marked sold or withdrawn. Confirm a current active listing before proceeding. Existing evidence and your preferences are retained.',
  provisional: 'This is a weighted utility under the supplied inputs, price and priorities. It uses disclosed product rules that have not been calibrated against buyer outcomes. It is not a probability of a successful purchase or appreciation.',
  insufficient: 'Share a clear maximum purchase budget plus brief household finances, a bedroom requirement or a viewing impression for an initial personalised estimate. Chat can guide you through missing financial inputs. Current address, parcel and flood checks are required. Your notes and documents update the evidence as they arrive.',
  clarification: 'A budget range or unclear amount needs clarification. State one maximum purchase budget to continue.',
  over_budget: 'The expected purchase price exceeds your stated maximum purchase budget. A high preference score cannot override this constraint.',
  needs_review: 'A reported issue or public map screening flag needs independent review. It is not a confirmed diagnosis, and an encouraging viewing note cannot clear it.',
  conflict: 'Some current sources disagree about an input. The conflicting value is excluded and purchase support is paused. Review the quoted evidence; you can withdraw an incorrect document in chat.',
  finance_hold: 'A financial input needs clarification, exceeds a reported loan limit or produces negative monthly cash flow. Review the quoted inputs and constraints below; a preference score cannot override them.',
};

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
}
function closeAddressSuggestions() {
  clearTimeout(addressTimer);addressController?.abort();addressGeneration++;addressOptions=[];activeAddress=-1;
  $('address-popover').hidden=true;$('property-address').setAttribute('aria-expanded','false');$('property-address').removeAttribute('aria-activedescendant');
}
function highlightAddress(index) {
  activeAddress=index;
  for (const [i,option] of [...$('address-options').children].entries()) option.setAttribute('aria-selected',String(i===index));
  const selected=$('address-options').children[index];
  if(selected){$('property-address').setAttribute('aria-activedescendant',selected.id);selected.scrollIntoView({block:'nearest'});}
  else $('property-address').removeAttribute('aria-activedescendant');
}
function chooseAddress(index) {
  const selected=addressOptions[index];if(!selected)return;
  $('property-address').value=selected.address;closeAddressSuggestions();$('property-address').focus();
}
async function loadAddressSuggestions(generation) {
  const query=$('property-address').value.trim();
  if(generation!==addressGeneration || $('entry').hidden || document.activeElement!==$('property-address'))return;
  addressController=new AbortController();
  $('address-options').replaceChildren();$('address-status').textContent='Finding official Auckland addresses…';$('address-popover').hidden=false;$('property-address').setAttribute('aria-expanded','true');
  try {
    const response=await apiFetch(`/api/addresses?q=${encodeURIComponent(query)}`,{signal:addressController.signal});
    if(!response.ok)throw new Error();const result=await response.json();
    if(generation!==addressGeneration || $('entry').hidden || document.activeElement!==$('property-address'))return;
    addressOptions=result.suggestions??[];activeAddress=-1;
    $('address-status').textContent=result.state==='ready'?'LINZ · Choose an address':result.message;
    for(const [index,candidate] of addressOptions.entries()) {
      const option=node('li','',candidate.address);option.id=`address-option-${generation}-${index}`;option.setAttribute('role','option');option.setAttribute('aria-selected','false');
      option.addEventListener('pointerdown',event=>event.preventDefault());option.addEventListener('click',()=>chooseAddress(index));$('address-options').append(option);
    }
  } catch(error) { if(error.name!=='AbortError' && generation===addressGeneration)$('address-status').textContent='Suggestions are temporarily unavailable. Enter the full address manually.'; }
}
function queueAddressSuggestions() {
  closeAddressSuggestions();
  const query=$('property-address').value.trim();
  if(query.length<2 || !/^\d/.test(query) || $('entry').hidden)return;
  const generation=addressGeneration;addressTimer=setTimeout(()=>void loadAddressSuggestions(generation),280);
}
$('property-address').addEventListener('input',event=>{if(!event.isComposing)queueAddressSuggestions();});
$('property-address').addEventListener('compositionend',queueAddressSuggestions);
$('property-address').addEventListener('focus',()=>{if($('address-popover').hidden)queueAddressSuggestions();});
$('property-address').addEventListener('blur',closeAddressSuggestions);
$('property-address').addEventListener('keydown',event=>{
  if(event.isComposing)return;
  if(event.key==='Escape') {closeAddressSuggestions();return;}
  if(event.key==='Tab') {closeAddressSuggestions();return;}
  if($('address-popover').hidden || !addressOptions.length)return;
  if(event.key==='ArrowDown' || event.key==='ArrowUp') {event.preventDefault();const down=event.key==='ArrowDown';highlightAddress(activeAddress<0?(down?0:addressOptions.length-1):(activeAddress+(down?1:-1)+addressOptions.length)%addressOptions.length);}
  if(event.key==='Enter' && activeAddress>=0) {event.preventDefault();chooseAddress(activeAddress);}
});
function errorAt(id, message = '') { $(id).textContent = message; $(id).hidden = !message; }
function openDialog(id) { if (!$(id).open) $(id).showModal(); }
function closeDialog(id) { if ($(id).open) $(id).close(); }
function setBusy(value) {
  busy = value;
  for (const id of ['entry-submit', 'chat-send', 'attach-main', 'attach-chat', 'price-save', 'open-price', 'go-home', 'confirm-delete']) $(id).disabled = value;
  $('chat-send').textContent = value ? 'Updating…' : 'Send ↗';
}
async function api(path, method = 'GET', data) {
  const response = await apiFetch(path, { method, headers: data ? { 'Content-Type': 'application/json' } : {}, body: data ? JSON.stringify(data) : undefined });
  const value = await response.json();
  if (!response.ok) { const error = new Error(value.error ?? 'This request could not be completed.'); error.status = response.status; throw error; }
  return value;
}
function priceValue(raw) {
  const value = raw.trim();
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(value)) throw new Error('Enter a price such as 920,000.');
  const cents = Math.round(Number(value.replace(/,/g, '')) * 100);
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 10_000_000_000) throw new Error('Enter a positive purchase price below NZ$100 million.');
  return cents;
}
function metric(id, value) {
  const element = $(id);
  element.replaceChildren(document.createTextNode(value == null ? '—' : String(value)));
  element.classList.toggle('is-unavailable', value == null);
  if (value != null) element.append(node('span', 'percent', '%'));
}
function renderProject() {
  if (!project) return;
  researching=researchRequests.has(project.id);researchProjectId=researching?project.id:null;
  $('entry').hidden = true;
  $('decision-page').hidden = false;
  $('current-address').textContent = project.address;
  const listing=project.research?.listing,checking=researching && researchProjectId===project.id || project.research?.state==='running';
  const freshListing=listing?.checkedAt && Date.now()-Date.parse(listing.checkedAt)>=0 && Date.now()-Date.parse(listing.checkedAt)<86400000;
  const listingState=freshListing?listing.state:checking?'checking':'unknown';
  $('listing-status').hidden=project.synthetic;$('listing-status').dataset.state=listingState;
  $('listing-status').textContent=({for_sale:'Listed for sale',sold:'Listing marked sold',withdrawn:'Listing withdrawn',checking:'Checking listing availability…'})[listingState]??(project.research?.state==='ambiguous'?'Confirm address to check availability':project.research?.state==='unmatched'?'Check address to verify availability':'Listing availability unverified');
  $('current-price').textContent = `NZ$ ${money(project.priceCents)}`;
  $('open-about').textContent = project.synthetic ? 'Demo' : 'Preview';
  const d = project.decision;
  metric('support-value', d.support);
  metric('completeness-value', d.completeness);
  $('support-status').textContent = states[d.state];
  if (d.state === 'insufficient' && project.research?.state === 'ambiguous') $('support-status').textContent = 'Confirm address';
  if (d.state === 'insufficient' && project.research?.state === 'unmatched') $('support-status').textContent = 'Check address';
  if (['insufficient','provisional'].includes(d.state)) {
    if (checking) $('support-status').textContent = 'Checking sources…';
    else if (['queued','running'].includes(project.analysis?.state)) $('support-status').textContent = 'Analyzing…';
  }
  $('support-status').classList.toggle('is-paused', d.state !== 'provisional');
  $('coverage-caption').textContent=checking?'Coverage by area · Checking sources…':!project.synthetic && ['unavailable','unmatched','interrupted'].includes(project.research?.state)?'Coverage by area · Check public sources':'Coverage by area';
  $('completeness-track').setAttribute('aria-valuenow', d.completeness);
  $('completeness-track').firstElementChild.style.width = `${d.completeness}%`;
  $('share-track').replaceChildren();
  $('share-track').setAttribute('aria-label', `Analysis shares: ${d.areas.map(a => `${a.label} ${a.share}%`).join(', ')}`);
  $('share-rows').replaceChildren();
  $('coverage-rows').replaceChildren();
  for (const area of d.areas) {
    const segment = node('span'); segment.style.width = `${area.share}%`; segment.setAttribute('aria-hidden', 'true'); $('share-track').append(segment);
    const row = node('button', 'area-row');
    row.type = 'button'; row.setAttribute('aria-label', `Inspect ${area.label} analysis, ${area.share} percent, read only`);
    row.append(node('span', 'area-label', area.label), node('span', 'area-number', `${area.share}%`));
    row.addEventListener('click', () => areaDetails(area.id));
    $('share-rows').append(row);
    const coverage = node('button', 'area-row coverage-row');
    coverage.type = 'button'; coverage.setAttribute('aria-label', `Inspect ${area.label} evidence coverage, ${Math.round(area.coverage)} percent`);
    const track = node('span', 'mini-track'); track.setAttribute('aria-hidden', 'true');
    const fill = node('span'); fill.style.width = `${area.coverage}%`; track.append(fill);
    coverage.append(node('span', 'area-label', area.label), track, node('span', 'area-number', `${Math.round(area.coverage)}%`));
    coverage.addEventListener('click', () => areaDetails(area.id));
    $('coverage-rows').append(coverage);
  }
  renderConversation();
}
function showProject(value, updateHash = true) {
  if (project?.id===value.id && value.revision<project.revision) return;
  project = value;
  if (updateHash && location.hash !== `#/project/${project.id}`) history.pushState(null, '', `#/project/${project.id}`);
  errorAt('app-error');
  renderProject();
}
function showEntry() {
  project = null;
  closeAddressSuggestions();
  $('entry').hidden = false;
  $('decision-page').hidden = true;
  $('open-about').textContent = 'Demo';
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
}
async function route() {
  const match = location.hash.match(/^#\/project\/([a-f0-9-]{36})$/);
  if (!match) return showEntry();
  try { showProject(await api(`/api/projects/${match[1]}`), false); void initialResearch(); scheduleAnalysis(); }
  catch (error) { showEntry(); errorAt('app-error', error.message); }
}
function renderConversation() {
  $('chat-messages').replaceChildren();
  $('chat-suggestions').hidden = project.messages.length > 0;
  if (!project.messages.length) $('chat-messages').append(node('p', 'chat-welcome', 'Tell us what matters to you, what you can afford, or how the property felt. Your conversation shapes the analysis.'));
  for (const message of project.messages) {
    const bubble = node('div', `chat-message ${message.role}`);
    if (message.filename) bubble.append(node('span', 'file-label', message.filename));
    bubble.append(document.createTextNode(message.text));
    $('chat-messages').append(bubble);
  }
  $('chat-messages').scrollTop = $('chat-messages').scrollHeight;
}
function openConversation() {
  if (!project) return;
  renderConversation(); openDialog('chat-dialog');
  $('chat-text').focus();
  $('chat-messages').scrollTop = $('chat-messages').scrollHeight;
  const pending=project.documentJobs?.find(j=>['waiting_gpu','waiting_setup','failed','interrupted'].includes(j.state));
  if(pending)errorAt('chat-error',`${pending.filename}: ${pending.message}`);
}
async function pollDocument(projectId,initial){
  const key=projectId+':'+initial.id;if(documentPolls.has(key))return;documentPolls.add(key);
  try{
    let job=initial;
    while(['queued','reading'].includes(job.state)){
      if(project?.id===projectId)errorAt('chat-error',`Reading ${job.filename} locally…${job.totalPages?` ${job.completedPages}/${job.totalPages} pages.`:''} You can continue chatting.`);
      await new Promise(resolve=>setTimeout(resolve,1200));
      job=await api(`/api/projects/${projectId}/documents/${job.id}`);
    }
    if(project?.id===projectId){
      showProject(await api(`/api/projects/${projectId}`));
      errorAt('chat-error',job.state==='complete'?'':`${job.filename}: ${job.message}`);
      if(job.state==='complete')scheduleAnalysis();
    }
  }catch(error){if(project?.id===projectId)errorAt('chat-error',error.message);}
  finally{documentPolls.delete(key);}
}
async function submitScannedPDF(file,projectId,plan){
  const result=await uploadLocalPDF(file,projectId,plan);
  void pollDocument(projectId,result);
}
async function submitInformation(input) {
  if (!project) return;
  const id=project.id;let value;
  try { value=await api(`/api/projects/${id}/information`, 'POST', { ...input, expectedRevision: project.revision }); }
  catch(error) {
    if(error.status!==409 || project?.id!==id) throw error;
    showProject(await api(`/api/projects/${id}`));
    value=await api(`/api/projects/${id}/information`, 'POST', { ...input, expectedRevision: project.revision });
  }
  if(project?.id===id) showProject(value);
  scheduleAnalysis();
}
function stat(label, value) { const item = node('div', 'detail-stat', label); item.append(node('strong', '', value)); return item; }
function publicFresh(source) {
  const age = Date.now() - Date.parse(source.retrievedAt);
  return source.active !== false && Number.isFinite(age) && age >= 0 && age < 86400000;
}
function sourceLink(label, href) {
  try { const url = new URL(href); if (url.protocol !== 'https:') return node('span', '', label); }
  catch { return node('span', '', label); }
  const link = node('a', 'source-link', label); link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer'; return link;
}
async function runResearch(addressId = null) {
  if (!project || project.synthetic || researching || busy) return;
  const id = project.id, revision = project.revision;
  researchRequests.add(id);renderProject();
  void pollResearch(id);
  try {
    const value = await api(`/api/projects/${id}/research`, 'POST', { expectedRevision: revision, ...(addressId == null ? {} : { addressId }) });
    if (project?.id === id) {
      showProject(value);
      if ($('detail-dialog').open) refreshDetails();
    }
  } catch (error) {
    if (project?.id === id) {
      if (error.status === 409) { try { showProject(await api(`/api/projects/${id}`)); } catch {} }
      errorAt('app-error', error.message);
    }
  } finally {
    researchRequests.delete(id);
    if (project) { renderProject(); if ($('detail-dialog').open) refreshDetails(); }
    scheduleAnalysis();
    if (project?.id !== id) void initialResearch();
  }
}
async function pollResearch(id) {
  if(researchPollingId===id)return;researchPollingId=id;
  try {
    while(project?.id===id && (researching && researchProjectId===id || project.research?.state==='running')) {
      await new Promise(resolve=>setTimeout(resolve,900));
      if(project?.id!==id)return;
      const value=await api(`/api/projects/${id}`);
      if(project?.id!==id)return;
      showProject(value);if($('detail-dialog').open)refreshDetails();
      if(!['running'].includes(value.research?.state) && !(researching && researchProjectId===id))break;
    }
  }catch(error){if(project?.id===id && error.status===404)errorAt('app-error',error.message);}
  finally{if(researchPollingId===id)researchPollingId=null;if(project?.id===id && project.research.state!=='running')scheduleAnalysis();}
}
async function initialResearch() {
  if(!project || project.synthetic)return;
  if(project.research.state==='running') {void pollResearch(project.id);return;}
  const age=Date.now()-Date.parse(project.research.completedAt);
  if (['not_started','interrupted'].includes(project.research.state) || project.research.version!=='public-evidence-0.8' || age>=86400000 || ['unavailable','partial'].includes(project.research.state) && age>=60000) await runResearch();
}
function listingDetails(content) {
  if(project.synthetic)return;
  const listing=project.research?.listing;
  content.append(node('h3','','Listing availability'),node('p','',listing?.message??'The current sale listing has not been checked yet.'));
  if(listing?.checkedAt)content.append(node('p','',`Checked: ${dateLabel(listing.checkedAt)}. Refresh public sources to recheck availability.`));
  if(listing?.statusHeading)content.append(node('blockquote','',`${listing.matchedAddress} — ${listing.statusHeading}`));
  if(listing?.url)content.append(sourceLink('Open checked agency listing',listing.url));
  for(const url of listing?.conflictingUrls??[])content.append(sourceLink('Inspect conflicting listing',url));
}
function researchDetails(content) {
  if (project.synthetic) return;
  content.append(node('h3', '', 'Public data checks'));
  content.append(node('p', '', researching ? 'Checking the address and public records… You can continue adding notes.' : project.research.message ?? 'Public data checks have not run yet.'));
  if (project.research.identity) content.append(node('p', '', `Matched address: ${project.research.identity.address}. ${project.research.identity.match === 'user_confirmed' ? 'Confirmed by you and rechecked at the source.' : 'Exact address match.'}`));
  listingDetails(content);
  if (project.research.completedAt) content.append(node('p', '', `Last checked: ${dateLabel(project.research.completedAt)}. Records stop contributing to completeness after 24 hours without a refresh. Completed results are reused for five minutes; incomplete checks can be retried.`));
  for (const check of project.research.checks) content.append(node('p', 'research-check', `${check.label} · ${check.state.replaceAll('_', ' ')} — ${check.message}`));
  if (project.research.state === 'ambiguous') {
    content.append(node('p', '', 'Choose the exact property. No records are attached until the address is confirmed.'));
    for (const candidate of project.research.candidates) {
      const button = node('button', 'saved-project', candidate.address); button.disabled = researching || busy;
      button.addEventListener('click', () => runResearch(candidate.id)); content.append(button);
    }
  }
  const button = node('button', 'text-button', researching ? 'Checking public data…' : 'Refresh public data');
  button.disabled = researching || busy; button.addEventListener('click', () => runResearch()); content.append(button);
  content.append(node('p', '', dataNotice));
}
function scheduleAnalysis() {
  clearTimeout(analysisTimer);
  analysisTimer=setTimeout(()=>{void runAnalysis();},1000);
}
async function runAnalysis() {
  if (!project || project.synthetic || !project.research?.identity || project.research.state==='running' || researching || busy || analysisStarting) return;
  const id=project.id; analysisStarting=true;
  try {
    const value=await api(`/api/projects/${id}/analysis`,'POST',{expectedRevision:project.revision});
    analysisStarting=false;
    if (project?.id!==id) return;
    showProject(value); if ($('detail-dialog').open) refreshDetails();
    if (!['queued','running'].includes(value.analysis?.state) || analysisPollingId===id) return;
    analysisPollingId=id;
    try {
      while (project?.id===id && ['queued','running'].includes(project.analysis?.state)) {
        await new Promise(resolve=>setTimeout(resolve,1500));
        if (project?.id!==id) break;
        const next=await api(`/api/projects/${id}`);
        if (project?.id===id) { showProject(next); if ($('detail-dialog').open) refreshDetails(); }
      }
      if (project?.id===id && ['stale','interrupted'].includes(project.analysis?.state)) scheduleAnalysis();
    } finally { analysisPollingId=null; if (project?.id!==id) scheduleAnalysis(); }
  } catch(error) {
    if (project?.id===id && error.status===409) { try {showProject(await api(`/api/projects/${id}`));scheduleAnalysis();} catch {} }
    else if (project?.id===id) errorAt('app-error',error.message);
  } finally { analysisStarting=false; }
}
function agentDetails(content,area=null) {
  if (project.synthetic) return;
  content.append(node('h3','','Multi-Agent analysis'));
  content.append(node('p','',`Status: ${project.analysis?.state ?? 'waiting for address checks'}. Each model statement is linked to supplied evidence; source checking does not establish professional clearance. AI cannot assign purchase support.`));
  if (project.analysis?.error) content.append(node('p','',project.analysis.error));
  for (const [role,state] of Object.entries(project.analysis?.progress ?? {})) content.append(node('p','source-status',`${role.charAt(0).toUpperCase()+role.slice(1)} Agent · ${state}`));
  for (const agent of project.analysis?.agents ?? []) {
    if (area && !agent.areas.includes(area) && agent.id!=='verification') continue;
    const article=node('article','source-item'); article.append(node('h4','',agent.label),node('p','source-status',`${agent.state}${agent.cached ? ' · reused unchanged analysis' : ''}`));
    for (const claim of agent.claims ?? []) {
      article.append(node('p','',`${claim.kind === 'fact' ? 'Source-linked AI statement' : claim.kind === 'inference' ? 'AI inference' : 'Missing information'}: ${claim.text}`));
      if (claim.quote) article.append(node('blockquote','',claim.quote));
      const source=project.sources.find(s=>s.id===claim.sourceId) ?? project.decision.model?.calculationSources.find(s=>s.id===claim.sourceId);
      if (source?.kind==='calculation') article.append(node('p','source-status',source.areas.includes('market')?'Source: deterministic calculation from attributed public records; not a registered valuation.':'Source: deterministic calculation from the supplied inputs; not a lender decision.'));
      if (source?.url) article.append(sourceLink(source.label,source.url));
      if (claim.review) article.append(node('p','source-status',`Verification Agent: ${claim.review}. ${claim.reviewReason}`));
    }
    if (agent.missing?.length) article.append(node('p','',`Still needed: ${agent.missing.join('; ')}`));
    content.append(article);
  }
  const button=node('button','text-button','Run analysis again'); button.disabled=analysisStarting || researching || busy || !project.research?.identity;
  button.addEventListener('click',()=>{void runAnalysis();}); content.append(button);
}
function bayesianDetails(content,model){
  if(!model)return;
  content.append(node('h3','','Bayesian risk scenarios'),node('p','',model.parameters.calibration),node('p','',model.parameters.dependence));
  for(const risk of model.risks){
    content.append(node('h4','',risk.label),node('p','',`Hypothesis being modelled: ${risk.hypothesis}`),node('p','',riskExplanation(risk)));
    if(risk.selected){const evidence=risk.selected;content.append(node('p','source-status',`Selected ${evidence.kind==='document'?'supplied report finding':'firsthand viewing note'}: ${project.sources.find(s=>s.id===evidence.sourceId)?.label??evidence.sourceId}${evidence.page==null?'':`, page ${evidence.page}`}${evidence.reportDate?`, report date ${evidence.reportDate}`:evidence.observedDate?`, stated viewing date ${evidence.observedDate}`:`, viewing date not supplied; recorded ${evidence.recordedDay}`}. Expected condition utility ${risk.expectedUtility.toFixed(2)}/100 = 80 × (1 − posterior) + 20 × posterior.`),node('blockquote','',evidence.quote));}
    if(risk.excluded.length)content.append(node('p','',`${risk.excluded.length} other finding(s) were not multiplied into this condition's odds.`));
    if(risk.excluded.length>8)content.append(node('p','source-status',`Showing the latest 8 of ${risk.excluded.length} excluded observations. The full calculation retains every exclusion.`));
    for(const evidence of risk.excluded.slice(-8))content.append(node('p','source-status',`${project.sources.find(s=>s.id===evidence.sourceId)?.label??evidence.sourceId}: ${evidence.reason.replaceAll('_',' ')}${evidence.page==null?'':`, page ${evidence.page}`}.`),node('blockquote','',evidence.quote));
  }
  content.append(node('p','','No validated Auckland base-rate or inspection-accuracy dataset is attached to this model. Title, insurance and statutory hazards remain separate review constraints. A lower conditional scenario cannot clear a material-risk hold.'));
}
function monteCarloDetails(content,model){
  const d=monteCarloExplanation(model);content.append(node('h3','',d.title),node('p','',d.intro));
  for(const missing of d.missing)content.append(node('p','source-status',missing));
  for(const assumption of d.assumptions)content.append(node('p','',assumption));
  for(const c of d.cases)content.append(node('h4','',c.title),node('p','',c.distribution),node('p','',c.conditional),node('p','',c.holds),node('p','source-status',c.precision));
  if(d.anchors.length){content.append(node('h4','','Economic sensitivity checks'),node('p','',d.anchorIntro));for(const a of d.anchors)content.append(node('p','',a.label+': '+a.result),node('p','source-status',a.inputs));}
}
function calculationDetails(content, area) {
  const calculation = area.calculation;
  if (!calculation) return;
  content.append(node('h3', '', 'How this area is calculated'));
  content.append(node('p', '', calculation.basis), node('p', '', `Rule: ${calculation.formula}`));
  if (area.id==='property') {content.append(node('p','','Reported roof grade: good 90, fair 60, poor 20. Structural and moisture utility = 80 × (1 − modelled posterior) + 20 × modelled posterior. The mean uses midpoint 50 and 0–100 bounds for unknown components. These are disclosed product assumptions.'));bayesianDetails(content,calculation.risk);}
  if (calculation.missing.length) content.append(node('p', '', `Inputs still needed: ${calculation.missing.join('; ')}.`));
  for (const input of calculation.inputs) {
    const value = input.valid===false ? 'Needs clarification' : input.key.endsWith('_cents') ? `NZ$ ${money(input.value)}` : input.key.endsWith('_percent') ? `${input.value}%` : input.key.endsWith('_minutes') ? `${input.value} minutes` : input.key.endsWith('_years') ? `${input.value} years` : String(input.value).replaceAll('_', ' ');
    content.append(node('p', '', `${input.label}: ${input.status==='derived_from_viewing_note'?`${input.value*10}/100 (product mapping)`:value}${input.asOf ? ` (as at ${input.asOf})` : ''}. ${input.status==='derived_from_viewing_note' ? 'Derived by a disclosed product rule from your note; you did not state this numeric rating.' : input.status==='derived_public_reference' ? 'Calculated from attributed public evidence; not a registered valuation.' : input.status==='public_record' ? 'Public record.' : input.status==='agency_marketing' ? 'Agency marketing; not independently inspected.' : 'User supplied; not independently verified.'}`), node('blockquote', '', input.quote));
    if(input.context)content.append(node('p','source-status',`Answer to: ${input.context.question} The short answer is interpreted in that question’s context.${input.key.includes('_monthly_')?' Stated weekly, fortnightly or annual amounts are converted to monthly averages.':''}`));
  }
  const c = calculation.calculations;
  if(['lifestyle','location'].includes(area.id)&&c?.components){
    content.append(node('h3','','Personal fit by requirement'));
    content.append(node('p','','Only explicitly requested criteria are active. Each active criterion has an equal share within this area. Missing or unresolved inputs keep their place in the calculation with provisional midpoint 50 and bounds 0–100; they are not confirmed property features.'));
    for(const component of c.components){
      content.append(node('h4','',component.label),node('p','',`${component.utility==null?`Needs clarification: ${component.missing.join('; ')}`:`Utility ${Number(component.utility.toFixed(1))}/100`}. Deterministic component bounds: ${Number(component.lower.toFixed(1))}–${Number(component.upper.toFixed(1))}/100. ${component.formula}`));
      content.append(node('p','source-status',`Input source IDs: ${component.sourceIds.join(', ')}.`));
    }
    if(!c.components.length)content.append(node('p','','No active, explicit requirement is available for this area. An unrequested feature is not treated as a satisfied need.'));
    if(calculation.utilityRange)content.append(node('p','',`Area utility bounds: ${Number(calculation.utilityRange.lower.toFixed(1))}–${Number(calculation.utilityRange.upper.toFixed(1))}/100. These are deterministic utility bounds, not a confidence interval or probability.`));
  }
  if(area.id==='market' && c?.referenceCents!=null)content.append(node('p','',`Selected price reference: NZ$ ${money(c.referenceCents)}. Expected price: NZ$ ${money(c.priceCents)}.${c.lowerReferenceCents==null?'':` Reference span: NZ$ ${money(c.lowerReferenceCents)}–NZ$ ${money(c.upperReferenceCents)}. This is an observed reference span, not a statistical confidence interval or registered valuation.`}`));
  if (area.id==='finance' && c?.monthlyPaymentCents!=null) content.append(node('p', '', `Required mortgage: NZ$ ${money(c.principalCents)}. Estimated monthly P&I: NZ$ ${money(c.monthlyPaymentCents)}. Monthly Council rates: NZ$ ${money(c.monthlyRatesCents)}. Surplus after the supplied costs and savings buffer: NZ$ ${money(c.monthlySurplusCents)}. At ${c.stressRatePercent == null ? 'no borrowing' : `${c.stressRatePercent}% interest (+2 percentage points)`}: monthly P&I NZ$ ${money(c.stressedMonthlyPaymentCents)}, surplus NZ$ ${money(c.stressedMonthlySurplusCents)}.`));
  if(area.id==='finance' && calculation.mode==='public_scenario'){
    content.append(node('p','',`Scenario interest: ${c.ratePercent}% p.a.; amortisation: ${c.termYears} years. Other monthly ownership costs: NZ$ ${money(c.otherOwnershipMonthlyCents)} (planning scenarios NZ$ ${money(c.otherOwnershipRangeCents[0])}–NZ$ ${money(c.otherOwnershipRangeCents[1])}). Savings buffer: NZ$ ${money(c.bufferMonthlyCents)}. These scenarios are not guaranteed cost bounds.`));
    for(const assumption of calculation.assumptions)content.append(node('p','',assumption));
  }
  for (const conflict of project.decision.model.inputs.conflicts.filter(c=>c.area===area.id)) {
    content.append(node('p', '', `Conflicting input: ${conflict.label}. No value was selected.`));
    for (const record of conflict.records) content.append(node('blockquote', '', record.quote));
  }
}
function areaDetails(id) {
  detailView = id;
  const area = project.decision.areas.find(a => a.id === id);
  $('detail-heading').textContent = area.label;
  const content = $('detail-content'); content.replaceChildren();
  const stats = node('div', 'detail-stats');
  stats.append(stat('Analysis share', `${area.share}%`), stat('Coverage', `${area.covered.length} / ${area.required.length}`));
  content.append(stats);
  if (id==='market') {
    const value=project.sources.find(s=>s.kind==='public_data' && s.provider==='council-rating-valuation' && publicFresh(s))?.data;
    const reference=area.calculation?.calculations?.referenceCents;
    if(reference){const gap=(project.priceCents/reference-1)*100;content.append(node('p','',`Selected price reference: NZ$ ${money(reference)}. ${gap===0?'Expected price matches the selected price reference.':`Expected price is ${Math.abs(gap).toFixed(1)}% ${gap>0?'above':'below'} the selected price reference.`} This comparison is subject to the reference methodology and its stated limits.`));}
    else if(value?.capitalValueCents)content.append(node('p','',`Council capital value: NZ$ ${money(value.capitalValueCents)}, as at ${dateOnly(value.valuationDate)}. ${value.improvementsValueCents===0?'This is a land-only assessment and is not used as the completed house price reference.':'This dated rating assessment is context only and does not establish current market value or a bargain.'}`));
  }
  content.append(node('p', '', area.utility == null ? 'A property-specific score is not available for this area.' : `Current utility: ${Number(area.utility.toFixed(1))}/100. Using its unrounded analysis share (${(area.weight==null?area.share:100*area.weight).toFixed(2)}%), its weighted contribution is ${area.contribution.toFixed(1)} points.`));
  content.append(node('p', '', 'Analysis shares follow clear priorities in your conversation. Coverage counts information items collected; it does not establish that a property is safe or that a statement is accurate.'));
  const weight = project.decision.weighting?.criteria.find(c=>c.id===id);
  if(weight){
    const ahp=project.decision.weighting.ahp,component=ahp?.components.find(c=>c.ids.includes(id));
    if(ahp?.applied){
      content.append(node('h3','','Pairwise AHP weighting'),node('p','',`Weight calculation: ${ahp.complete?'principal right eigenvector of the complete reciprocal judgment matrix':ahp.connected?'principal right eigenvector of the incomplete Harker matrix':'within-group eigenvector AHP with disclosed fallback group masses'}. ${ahp.comparisonCount} of ${ahp.possibleComparisons} comparisons supplied. Unrounded weight ${(100*weight.weight).toFixed(4)}%; display shares are rounded separately to total 100%.`));
      if(ahp.complete)content.append(node('p','',`Complete-matrix consistency: λmax ${ahp.eigenvalue.toFixed(6)}, CI ${ahp.consistencyIndex.toFixed(6)}, CR ${ahp.consistencyRatio.toFixed(4)} (limit ${ahp.policy.consistencyLimit}). Consistency is not evidence of accuracy or professional clearance.`));
      else content.append(node('p','','Full-matrix CR is unavailable because comparisons are missing. Missing judgments have not been filled from existing weights or attributed to you. A tree has no independent consistency redundancy.'));
      if(ahp.fallbackUsed&&component)content.append(node('p','',`This comparison group retains ${(100*component.fallbackMass).toFixed(2)}% combined conversation/base importance; relative importance between disconnected groups is not identified by your comparisons.`));
      if(component?.consistencyRatio!=null&&component.ids.length>=3&&!ahp.complete)content.append(node('p','',`This fully compared ${component.ids.length}-criterion component has CR ${component.consistencyRatio.toFixed(4)}. This is a component check, not the complete six-criterion CR.`));
    }else content.append(node('p','',`Fallback weight calculation: base ${weight.baseShare}% × priority multiplier ${weight.multiplier}, normalised across all six areas. The dashboard rounds shares to whole percentages; score arithmetic uses unrounded weights. ${ahp?.status==='inconsistent'?'The supplied comparisons are inconsistent; AHP weights are not applied pending clarification.':'No usable pairwise AHP weighting is active yet.'}`));
    if(ahp)content.append(node('p','source-status',`Incomplete-cycle product screen: observed-edge ratio mismatch above ${ahp.policy.partialMismatchLimit} requests clarification. This is not CR or a confidence estimate.`));
    const failure=ahpFailureExplanation(ahp,component);if(failure)content.append(node('p','',failure));
    for(const pair of weight.pairwiseEvidence??[]){const name=key=>project.decision.areas.find(a=>a.id===key).label;content.append(node('p','source-status',`Buyer comparison: ${name(pair.inputLeft??pair.left)} / ${name(pair.inputRight??pair.right)} = ${Number((pair.inputRatio??pair.ratio).toFixed(6))}. Source ${pair.sourceId}.`),node('blockquote','',pair.quote));if(pair.context)content.append(node('p','source-status',`Answer to: ${pair.context.question}`));}
    for(const pair of ahp?.unresolved.filter(p=>[p.left,p.right].includes(id))??[])content.append(node('p','','A comparison involving this area needs clarification; no replacement ratio was assumed.'),node('blockquote','',pair.quote));
    if(weight.evidence)content.append(node('p','source-status',`Priority source: ${weight.evidence.method==='explicit_chat'?'your stated conversation priority':'source-linked model preference review'} (${weight.evidence.sourceId}).`),node('blockquote','',weight.evidence.quote));
    else if(!ahp?.applied)content.append(node('p','source-status','No declared unary priority adjustment for this area; the fallback base importance applies.'));
  }
  calculationDetails(content,area);
  if(['finance','market'].includes(id))monteCarloDetails(content,project.decision.model?.monteCarlo);
  if(id==='property'&&area.calculation?.reports?.length){
    content.append(node('h3','','Report findings'));
    content.append(node('p','','Collected extracts remain user supplied and unauthenticated. Matching a title number establishes an identity link only. Freshness limits are product checks, not legal expiry; no report establishes complete building, legal or insurance clearance.'));
    for(const report of area.calculation.reports){
      content.append(node('h4','',`${({building:'Building inspection',title:'Title report',LIM:'LIM',consent:'Building consent drawings'})[report.type]??'Property document'} — ${report.label}`));
      content.append(node('p','source-status',`Identity: ${report.scope.replaceAll('_',' ')} (${report.identity.basis.replaceAll('_',' ')}). Date: ${report.reportDate??'missing or invalid'} — ${report.dateState.replaceAll('_',' ')}. ${report.coverage.length?'Report extract collected.':'Not counted as current report evidence.'}`));
      if(report.issuer)content.append(node('p','',`Reported issuer: ${report.issuer}; not authenticated.`));
      for(const finding of report.findings){
        content.append(node('p','',`${finding.label} — ${finding.disposition.replaceAll('_',' ')}${finding.severity==='material'?'; material issue needs independent review':finding.severity==='review'?'; follow-up required':''}${finding.page==null?'':`; page ${finding.page}`}.`));
        content.append(node('blockquote','',finding.quote));
      }
      for(const limitation of report.limitations)content.append(node('p','source-status',`Inspection limitation${limitation.page==null?'':` (page ${limitation.page})`}: ${limitation.quote}`));
      for(const message of report.notices)content.append(node('p','source-status',message));
    }
    for(const issue of project.facts.materialIssues)content.append(node('p','',`Unresolved reported risk${issue.page==null?'':` (page ${issue.page})`}: ${issue.quote}`));
  }
  agentDetails(content,id);
  content.append(node('h3', '', 'Information checklist'));
  const list = node('ul', 'requirement-list');
  for (const requirement of area.required) list.append(node('li', '', `${area.covered.includes(requirement) ? 'Collected' : 'Missing'} — ${id==='property'&&requirement==='title_review'?'title report extract (solicitor review still needed)':requirement.replace(/_/g, ' ')}`));
  content.append(list, node('h3', '', 'Sources'));
  const sources = project.sources.filter(s => area.sourceIds.includes(s.id));
  if (!sources.length) content.append(node('p', '', 'No source has been collected for this area.'));
  for (const source of sources) {
    const article = node('article', 'source-item');
    const status = source.kind === 'public_data' ? `${source.status==='agency_marketing'?'Agency marketing':'Public record'} — ${publicFresh(source) ? 'current retrieval' : 'inactive or needs refresh'}; limited to the stated query`
      : source.status === 'synthetic' ? 'Synthetic example — not real property evidence' : source.active===false ? 'Excluded from calculations' : source.scope && source.scope!=='current' ? 'Excluded — property address not matched' : 'User supplied — not independently verified';
    article.append(node('h4', '', source.label), node('p', 'source-status', status), node('blockquote', '', source.quote));
    const estimate=project.decision.model?.inputs.marketEvidence?.estimates.find(e=>e.sourceId===source.id);
    if(estimate && !estimate.applicable)article.append(node('p','source-status',`Not used for price scoring: ${estimate.reasons.map(r=>r.replaceAll('_',' ')).join('; ')}.`));
    if (source.kind === 'public_data') {
      article.append(node('p', 'source-status', `Publisher: ${source.publisher}. Retrieved ${dateLabel(source.retrievedAt)}. Dataset update: ${source.datasetUpdatedAt ? dateLabel(source.datasetUpdatedAt) : 'not supplied'}. Dataset updates are not the dates of every underlying model.`));
      article.append(sourceLink('Open source dataset', source.url));
      if (source.queryUrl) article.append(sourceLink(source.provider==='nz-mortgage-rates'?'Open official mortgage rate feed':source.provider==='watercare-residential-tariff'?'Open reviewed tariff PDF':'Reproduce this spatial query', source.queryUrl));
      article.append(node('p', 'source-status', source.attribution));
      if(source.provider!=='barfoot-regional-market') article.append(sourceLink('Source licence and limitations', source.licenseUrl));
    }
    content.append(article);
  }
  openDialog('detail-dialog');
}
function supportDetails() {
  detailView = 'support';
  $('detail-heading').textContent = 'Purchase support';
  const content = $('detail-content'); content.replaceChildren();
  content.append(node('p', '', explanations[project.decision.state]));
  content.append(node('p', '', project.decision.model?.aggregation ?? 'The score uses a weighted sum of the six example area utilities. Analysis shares total 100%.'));
  if(project.decision.methods){
    content.append(node('p','',`Weighting method: ${project.decision.methods.weighting.description}`));
    content.append(node('p','',`Uncertainty method: ${project.decision.methods.uncertainty.description}`));
  }
  if(project.decision.model?.partial){
    const range=project.decision.model.supportRange;
    content.append(node('p','',`Provisional utility bounds: ${range.lower}–${range.upper}/100. Calculated areas account for ${range.knownShare}% of the current analysis shares; ${range.unknownShare}% remains unresolved. Known areas use their central reference values; unresolved areas use a disclosed midpoint assumption. Public price spans are propagated to the bounds and are not statistical confidence intervals. The percentage is not the probability of a successful purchase. Budget fit does not establish mortgage affordability.`));
  }
  if(!project.synthetic)content.append(node('p','','Evidence completeness is a collection index with fixed area budgets: lifestyle 15%, location 20%, market 20%, property 20%, viewing 10%, finance 15%. It does not change when your decision priorities change. Advertised specifications count as collected marketing facts, not independent clearance. Missing inspection, LIM, title review and insurance remain visible in the property checklist.'));
  content.append(node('p', '', `Rule version: ${project.decision.rulesVersion}. Priorities follow your conversation and source-linked analysis. Public records do not establish a current market value, building clearance or mortgage approval.`));
  if (project.calculationRulesChanged) content.append(node('p','','This saved project is recalculated with the current evidence and weighting rules. Internal weights use unrounded values and source-linked priority statements. Your saved notes, reports and earlier percentage history are retained.'));
  if (project.decision.model) {
    bayesianDetails(content,project.decision.model.risk);
    monteCarloDetails(content,project.decision.model.monteCarlo);
    content.append(node('h3', '', 'Calculation inputs'));
    for (const area of project.decision.areas) if (area.calculation.missing.length) content.append(node('p', '', `${area.label} — still needed: ${area.calculation.missing.join('; ')}.`));
    if (!project.research?.identity || !project.decision.areas.find(a=>a.id==='location').covered.includes('address_match')) content.append(node('p', '', 'A current exact address check is still needed.'));
    for (const constraint of project.decision.model.constraints) content.append(node('blockquote', '', constraint.message));
    for (const gate of project.decision.model.gates) content.append(node('p', '', gate.message));
    for (const conflict of project.decision.model.inputs.conflicts) content.append(node('p', '', `Conflicting ${conflict.label}; inspect its area for the source quotes.`));
    for (const source of project.decision.model.inputs.excludedSources) content.append(node('p', '', `${source.label}: ${source.reason==='different_property' ? 'has conflicting property identifiers' : 'needs an exact address or a matching current title/legal reference'}. It has not contributed to calculations.`));
    for (const notice of project.decision.model.inputs.notices.slice(-5)) content.append(node('p', '', notice.message));
    content.append(node('p', '', 'To withdraw an incorrect upload, send: Exclude document "filename.pdf". Use its exact unique filename. Restore document "filename.pdf" includes it again. This cannot clear a material-risk hold.'));
  }
  agentDetails(content);
  researchDetails(content);
  if (project.facts.budgetCapCents) content.append(node('p', '', `Your stated maximum purchase budget: NZ$ ${money(project.facts.budgetCapCents)}.`));
  for (const issue of project.facts.materialIssues) content.append(node('blockquote', '', issue.quote));
  content.append(node('h3', '', 'Recent changes'));
  for (const change of project.history.slice(-6).reverse()) {
    content.append(node('p', '', `${dateLabel(change.at)} — ${change.explanation} Support: ${change.support ?? 'unavailable'}; completeness: ${change.completeness}%.`));
    for (const area of change.changedAreas ?? []) {content.append(node('p', 'source-status', `${area.label}: share ${area.shareBefore}% → ${area.shareAfter}%; utility ${area.utilityBefore == null ? 'unavailable' : area.utilityBefore.toFixed(1)} → ${area.utilityAfter == null ? 'unavailable' : area.utilityAfter.toFixed(1)}; coverage ${area.coverageBefore}% → ${area.coverageAfter}%.`));for(const risk of area.riskChanges??[])content.append(node('p','source-status',`${risk.label}: conditional scenario ${riskProbabilityLabel(risk.before)} → ${riskProbabilityLabel(risk.after)} under uncalibrated assumptions.`));for(const s of area.scenarioChanges??[]){const values=v=>v?[v.p10,v.median,v.p90].map(x=>x.toFixed(1)).join(' / '):'not run';content.append(node('p','source-status',`${s.label}: all-draw latent utility P10 / median / P90 ${values(s.before)} → ${values(s.after)}. Uncalibrated simulation; supported draws ${s.after.supported}/${s.after.draws}.`));}}
  }
  openDialog('detail-dialog');
}
function refreshDetails() { detailView === 'support' ? supportDetails() : detailView==='listing' ? openListingDetails() : areaDetails(detailView); }
function openListingDetails() {
  detailView='listing';$('detail-heading').textContent='Listing availability';const content=$('detail-content');content.replaceChildren();listingDetails(content);
  const refresh=node('button','text-button',researching?'Checking public data…':'Refresh public data');refresh.disabled=researching || busy;refresh.addEventListener('click',()=>void runResearch());content.append(refresh);openDialog('detail-dialog');
}

$('entry-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return;
  closeAddressSuggestions();
  errorAt('entry-error');
  try {
    const address = $('property-address').value.trim();
    if (!address) { $('property-address').focus(); throw new Error('Enter a property address.'); }
    const priceCents = priceValue($('expected-price').value);
    setBusy(true);
    showProject(await api('/api/projects', 'POST', { address, priceCents }));
  } catch (error) { errorAt('entry-error', error.message); }
  finally { setBusy(false); void initialResearch(); }
});
$('go-home').addEventListener('click', () => { history.pushState(null, '', location.pathname + location.search); showEntry(); $('property-address').focus(); });
window.addEventListener('popstate', route);
window.addEventListener('hashchange', route);
for (const button of document.querySelectorAll('[data-close]')) button.addEventListener('click', () => closeDialog(button.dataset.close));
for (const id of ['open-chat', 'open-chat-arrow']) $(id).addEventListener('click', openConversation);
$('support-status').addEventListener('click', supportDetails);
$('listing-status').addEventListener('click',openListingDetails);
for (const button of document.querySelectorAll('[data-suggestion]')) button.addEventListener('click', () => { $('chat-text').value = button.dataset.suggestion; $('chat-text').focus(); });
$('chat-text').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); $('chat-form').requestSubmit(); } });
$('chat-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return;
  const text = $('chat-text').value.trim(); if (!text) return;
  errorAt('chat-error'); setBusy(true);
  try { await submitInformation({ text }); $('chat-text').value = ''; $('chat-text').focus(); }
  catch (error) { if (error.status === 409) await route(); errorAt('chat-error', error.message); }
  finally { setBusy(false); }
});
$('open-price').addEventListener('click', () => { $('new-price').value = money(project.priceCents); errorAt('price-error'); openDialog('price-dialog'); $('new-price').focus(); });
$('price-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return; errorAt('price-error');
  try {
    const priceCents = priceValue($('new-price').value),id=project.id,originalPrice=project.priceCents;setBusy(true);let value;
    try {value=await api(`/api/projects/${id}/price`,'POST',{priceCents,expectedRevision:project.revision});}
    catch(error){if(error.status!==409)throw error;const latest=await api(`/api/projects/${id}`);showProject(latest);if(latest.priceCents!==originalPrice)throw new Error('The expected price changed in another view. Review it before saving your new price.');value=await api(`/api/projects/${id}/price`,'POST',{priceCents,expectedRevision:latest.revision});}
    showProject(value); closeDialog('price-dialog'); scheduleAnalysis();
  }
  catch (error) { if (error.status === 409) await route(); errorAt('price-error', error.message); }
  finally { setBusy(false); }
});
$('open-about').addEventListener('click', async () => {
  $('saved-projects').replaceChildren(node('p', '', 'Loading…'));
  $('request-delete').hidden = !project;
  openDialog('about-dialog');
  try {
    const data = await api('/api/projects'); $('saved-projects').replaceChildren();
    if (!data.projects.length) $('saved-projects').append(node('p', '', 'No saved projects yet.'));
    for (const p of data.projects) {
      const button = node('button', 'saved-project', `${p.address} · NZ$ ${money(p.priceCents)}`);
      button.addEventListener('click', async () => { try { showProject(await api(`/api/projects/${p.id}`)); closeDialog('about-dialog'); void initialResearch(); scheduleAnalysis(); } catch (error) { errorAt('app-error', error.message); } });
      $('saved-projects').append(button);
    }
  } catch (error) { $('saved-projects').replaceChildren(node('p', '', error.message)); }
});
$('request-delete').addEventListener('click', () => { closeDialog('about-dialog'); openDialog('delete-dialog'); });
$('confirm-delete').addEventListener('click', async () => {
  if (busy || !project) return; setBusy(true);
  try { await api(`/api/projects/${project.id}`, 'DELETE'); history.pushState(null, '', location.pathname + location.search); showEntry(); }
  catch (error) { errorAt('app-error', error.message); }
  finally { setBusy(false); }
});
for (const id of ['attach-main', 'attach-chat']) $(id).addEventListener('click', () => { if (!busy && project) $('document-file').click(); });
$('document-file').addEventListener('change', async event => {
  const file = event.target.files[0]; event.target.value = '';
  if (!file || !project || busy) return;
  openConversation(); errorAt('chat-error'); setBusy(true);
  try {
    if (file.size > 12 * 1024 * 1024) throw new Error('Please choose a document smaller than 12 MB.');
    let text;
    if (/\.pdf$/i.test(file.name)) {
      $('chat-send').textContent = 'Reading PDF…';
      const pdfjs = await import('./vendor/pdf.mjs?v=0.17.0');
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.mjs?v=0.17.0', import.meta.url).href;
      const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false });
      let pdf;
      try {
        pdf = await task.promise;
        if (pdf.numPages > 100) throw new Error('Please upload the relevant pages, up to 100 pages at a time.');
        const pages = await inspectPDFPages(pdf,{ops:pdfjs.OPS});
        const {pdfReadingPlan}=await import('./document-text.mjs?v=0.17.0');
        const plan=pdfReadingPlan(pages);
        if(plan.method==='ocr_fallback'){await submitScannedPDF(file,project.id,plan);return;}
        text = plan.text;
      } finally { await task.destroy(); }
    } else if (/\.(txt|md)$/i.test(file.name)) text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
    else throw new Error('Choose a PDF, UTF-8 TXT or Markdown document.');
    if ([...text].length > 120_000) throw new Error('Please use a relevant extract of up to 120,000 characters.');
    await submitInformation({ text, kind: 'document', filename: file.name });
  } catch (error) { errorAt('chat-error', error.message.includes('encoded data') ? 'This text file is not UTF-8. Save it as UTF-8 and try again.' : error.message); }
  finally { setBusy(false); }
});
route();
// Re-evaluate source age on an open page without re-sending an address to an external provider.
setInterval(async () => {
  if (!project || busy || researching || document.hidden) return;
  const id = project.id;
  try {
    const value = await api(`/api/projects/${id}`);
    if (project?.id === id && !busy && !researching && (value.revision !== project.revision || value.decision.completeness !== project.decision.completeness)) {
      showProject(value); if ($('detail-dialog').open) refreshDetails();
    }
  } catch {}
}, 60_000);
