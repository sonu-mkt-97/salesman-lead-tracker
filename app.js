import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithRedirect, signInWithEmailAndPassword, onAuthStateChanged, signOut, updateProfile, RecaptchaVerifier, signInWithPhoneNumber, EmailAuthProvider, linkWithCredential } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, onSnapshot, query, where, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const MANAGER_EMAIL = "balodiyacemented@gmail.com";
const $ = (id) => document.getElementById(id);
const dialog = $("leadDialog"), authDialog = $("authDialog"), registerDialog = $("registerDialog"), form = $("leadForm");
let leads = [], currentUser = null, isManager = false, stopLeads = null, otpConfirmation = null, registrationInProgress = false, recaptchaVerifier = null;
const charts = {};

function today() { return new Date().toISOString().slice(0, 10); }
function isOverdue(lead) { return lead.status === "Pending" && lead.nextFollowUp && lead.nextFollowUp <= today(); }
function isDone(lead) { return lead.status === "Done" || lead.status === "Converted"; }
function money(value) { return Number(value || 0).toLocaleString("en-IN", { style:"currency", currency:"INR", maximumFractionDigits:0 }); }
function esc(value = "") { const e = document.createElement("div"); e.textContent = value; return e.innerHTML; }
function setSync(text, error = false) { $("syncStatus").textContent = text; $("syncStatus").classList.toggle("error", error); }
function salesmanEmail(value) {
  const id = value.trim().toLowerCase();
  return id.includes("@") ? id : `${id.replace(/[^a-z0-9._-]/g, "")}@leadtracker.local`;
}
function countBy(items, fn) { return items.reduce((out, item) => { const key = fn(item) || "Unassigned"; out[key] = (out[key] || 0) + 1; return out; }, {}); }
function drawChart(id, type, labels, datasets) {
  if (!window.Chart) return;
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart($(id).getContext("2d"), { type, data:{ labels, datasets }, options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:datasets.length > 1, labels:{boxWidth:9,font:{size:11}}} }, scales:{x:{grid:{display:false},ticks:{font:{size:10}}},y:{beginAtZero:true,grid:{color:"#e7edf3"},ticks:{precision:0,font:{size:10}}}} } });
}
function renderCharts() {
  const status = ["Pending","Done","Converted","Cancelled","No Response"];
  drawChart("statusChart","bar",status,[{label:"Leads",data:status.map(s=>leads.filter(x=>x.status===s).length),backgroundColor:["#f0b429","#46a66b","#2d9d55","#8a98a6","#6597d7"],borderRadius:6}]);
  const dates = [...new Set(leads.map(x=>x.leadDate).filter(Boolean))].sort().slice(-7);
  const shortDates = dates.map(x=>x.slice(5));
  drawChart("leadsChart","line",shortDates,[{label:"New leads",data:dates.map(day=>leads.filter(x=>x.leadDate===day).length),borderColor:"#1e5aa8",backgroundColor:"#1e5aa822",fill:true,tension:.35,pointBackgroundColor:"#1e5aa8",pointRadius:4}]);
  const salesman = countBy(leads,x=>x.salesman);
  drawChart("salesmanChart","bar",Object.keys(salesman),[{label:"Total leads",data:Object.values(salesman),backgroundColor:"#3c7bd1",borderRadius:6}]);
  drawChart("conversionChart","line",shortDates,[{label:"Converted",data:dates.map(day=>leads.filter(x=>x.leadDate===day&&isDone(x)).length),borderColor:"#2d9d55",backgroundColor:"#2d9d5518",fill:true,tension:.35,pointRadius:3},{label:"Pending",data:dates.map(day=>leads.filter(x=>x.leadDate===day&&x.status==="Pending").length),borderColor:"#e1a50e",backgroundColor:"#e1a50e18",fill:true,tension:.35,pointRadius:3}]);
}

function render() {
  const search = $("searchInput").value.trim().toLowerCase(), filter = $("statusFilter").value;
  const visible = leads.filter((lead) => {
    const text = `${lead.customerName} ${lead.area} ${lead.mobile} ${lead.salesman}`.toLowerCase();
    return (!search || text.includes(search)) && (filter === "All" || lead.status === filter);
  }).sort((a,b) => (isOverdue(b)-isOverdue(a)) || (a.nextFollowUp || "9999").localeCompare(b.nextFollowUp || "9999"));
  $("totalCount").textContent = leads.length; $("pendingCount").textContent = leads.filter(x => x.status === "Pending").length;
  $("dueCount").textContent = leads.filter(isOverdue).length; $("wonCount").textContent = leads.filter(isDone).length; $("dashboardPeriod").textContent = `${leads.length} live leads`;
  $("emptyState").hidden = visible.length > 0;
  $("leadList").innerHTML = visible.map((lead) => {
    const alert = isOverdue(lead) ? `FOLLOW-UP DUE: ${lead.nextFollowUp}` : (lead.nextFollowUp ? `Next follow-up: ${lead.nextFollowUp}` : "No follow-up date");
    const stateClass = isOverdue(lead) ? "overdue" : lead.status.toLowerCase();
    const redCircle = isOverdue(lead) ? '<span class="alert-dot" aria-label="Follow-up overdue"></span>' : '';
    return `<article class="lead-card ${stateClass}" data-id="${lead.id}"><div class="lead-card-top"><div><h3>${redCircle}${esc(lead.customerName)}</h3><p>${esc(lead.mobile || "No mobile")} · ${esc(lead.area || "No area")}</p></div><span class="badge ${stateClass}">${esc(lead.status)}</span></div><div class="lead-card-footer"><span class="followup">${alert}</span><span class="amount">${Number(lead.salesAmount || 0) ? money(lead.salesAmount) : ""}</span></div></article>`;
  }).join("");
  document.querySelectorAll(".lead-card").forEach(card => card.addEventListener("click", () => openForm(leads.find(x => x.id === card.dataset.id))));
  renderCharts();
}

function openForm(lead) {
  if (!currentUser) return;
  form.reset(); $("formTitle").textContent = lead ? "Edit Lead" : "Add Lead"; $("deleteButton").hidden = !lead; $("leadId").value = lead?.id || ""; $("leadDate").value = lead?.leadDate || today();
  for (const key of ["customerName","mobile","area","product","salesman","stage","status","lastFollowUp","nextFollowUp","salesAmount","remark"]) $(key).value = lead?.[key] || (key === "stage" ? "New Lead" : key === "status" ? "Pending" : "");
  if (!isManager) $("salesman").value = currentUser.displayName || currentUser.email;
  $("salesman").disabled = !isManager; dialog.showModal();
}

async function ensureProfile(user) {
  const profile = doc(db, "users", user.uid), snapshot = await getDoc(profile);
  if (!snapshot.exists()) await setDoc(profile, { name: user.displayName || user.email, email: user.email || "", role: user.email === MANAGER_EMAIL ? "manager" : "salesman", createdAt: serverTimestamp() });
}
function subscribeToLeads() {
  if (stopLeads) stopLeads(); setSync("Syncing…");
  const source = isManager ? collection(db, "leads") : query(collection(db, "leads"), where("salesmanUid", "==", currentUser.uid));
  stopLeads = onSnapshot(source, (snapshot) => { leads = snapshot.docs.map(item => ({ id: item.id, ...item.data() })); setSync("Live data connected"); render(); }, (error) => { console.error(error); setSync("Access setup pending", true); });
}
async function handleUser(user) {
  currentUser = user;
  if (!user) { if (stopLeads) stopLeads(); stopLeads = null; leads = []; render(); $("accountBar").hidden = true; $("addLeadButton").disabled = true; authDialog.showModal(); return; }
  if (registrationInProgress) return;
  try { await ensureProfile(user); isManager = user.email === MANAGER_EMAIL; $("accountName").textContent = `${isManager ? "Manager" : "Salesman"}: ${user.displayName || user.email}`; $("accountBar").hidden = false; $("addLeadButton").disabled = false; if (authDialog.open) authDialog.close(); subscribeToLeads(); }
  catch (error) { console.error(error); $("authError").textContent = "Account setup is not ready. Please contact the manager."; authDialog.showModal(); }
}

$("addLeadButton").addEventListener("click", () => openForm()); $("closeDialog").addEventListener("click", () => dialog.close()); $("searchInput").addEventListener("input", render); $("statusFilter").addEventListener("change", render); $("signOutButton").addEventListener("click", () => signOut(auth));
form.addEventListener("submit", async (event) => {
  event.preventDefault(); const id = $("leadId").value, lead = {};
  for (const key of ["leadDate","customerName","mobile","area","product","salesman","stage","status","lastFollowUp","nextFollowUp","salesAmount","remark"]) lead[key] = $(key).value.trim();
  lead.salesmanUid = id ? (leads.find(x => x.id === id)?.salesmanUid || currentUser.uid) : currentUser.uid; lead.updatedAt = serverTimestamp();
  try { if (id) await updateDoc(doc(db, "leads", id), lead); else { lead.createdAt = serverTimestamp(); await addDoc(collection(db, "leads"), lead); } dialog.close(); } catch (error) { alert("Save failed. Please check internet or manager access."); console.error(error); }
});
$("deleteButton").addEventListener("click", async () => { const id = $("leadId").value; if (id && confirm("Delete this lead?")) { await deleteDoc(doc(db, "leads", id)); dialog.close(); } });
$("exportButton").addEventListener("click", () => { const cols = ["leadDate","customerName","mobile","area","product","salesman","stage","lastFollowUp","nextFollowUp","status","salesAmount","remark"]; const csv = [cols.join(","), ...leads.map(x => cols.map(k => `"${String(x[k] || "").replaceAll('"','""')}"`).join(","))].join("\n"); const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], {type:"text/csv"})); a.download = `leads-${today()}.csv`; a.click(); URL.revokeObjectURL(a.href); });
$("googleLoginButton").addEventListener("click", async () => { $("authError").textContent = ""; try { await signInWithRedirect(auth, new GoogleAuthProvider()); } catch { $("authError").textContent = "Google login could not start. Please try again."; } });
$("authForm").addEventListener("submit", async (event) => { event.preventDefault(); $("authError").textContent = ""; try { await signInWithEmailAndPassword(auth, salesmanEmail($("loginEmail").value), $("loginPassword").value); } catch (error) { $("authError").textContent = error.code === "auth/user-not-found" ? "This Salesman ID is not registered. Tap Create Salesman ID first." : "Login failed. Check your Salesman ID and password."; } });
function phoneNumber() { const digits = $("registerMobile").value.replace(/\D/g, ""); return digits.length === 10 ? `+91${digits}` : ""; }
function resetRegistration() { otpConfirmation = null; $("otpSection").hidden = true; $("accountSection").hidden = true; $("otpCode").value = ""; $("registerError").textContent = ""; }
$("registerButton").addEventListener("click", () => { resetRegistration(); $("registerForm").reset(); registerDialog.showModal(); });
$("closeRegister").addEventListener("click", () => registerDialog.close());
$("sendOtpButton").addEventListener("click", async () => {
  const name = $("registerName").value.trim(), mobile = phoneNumber(); $("registerError").textContent = "";
  if (!name) { $("registerError").textContent = "Enter the salesman’s full name."; return; }
  if (!mobile) { $("registerError").textContent = "Enter a valid 10 digit Indian mobile number."; return; }
  try {
    if (recaptchaVerifier) recaptchaVerifier.clear();
    recaptchaVerifier = new RecaptchaVerifier(auth, "recaptcha-container", { size: "invisible" });
    $("sendOtpButton").disabled = true; $("sendOtpButton").textContent = "Sending OTP…";
    otpConfirmation = await signInWithPhoneNumber(auth, mobile, recaptchaVerifier);
    $("otpSection").hidden = false; $("registerError").textContent = `OTP sent to ${mobile}.`;
  } catch (error) { console.error(error); $("registerError").textContent = "OTP could not be sent. Ask the manager to enable Phone sign-in in Firebase, then try again."; }
  finally { $("sendOtpButton").disabled = false; $("sendOtpButton").textContent = "Resend OTP"; }
});
$("verifyOtpButton").addEventListener("click", async () => {
  if (!otpConfirmation || !$("otpCode").value.trim()) { $("registerError").textContent = "Enter the OTP received on the mobile."; return; }
  try { registrationInProgress = true; await otpConfirmation.confirm($("otpCode").value.trim()); $("accountSection").hidden = false; $("otpSection").hidden = true; $("registerError").textContent = "Mobile verified successfully."; }
  catch (error) { registrationInProgress = false; $("registerError").textContent = "OTP is incorrect or expired. Please resend OTP."; }
});
$("completeRegisterButton").addEventListener("click", async () => {
  const id = $("registerId").value.trim(), password = $("registerPassword").value, name = $("registerName").value.trim(), mobile = phoneNumber();
  if (!/^[a-zA-Z0-9._-]{4,30}$/.test(id)) { $("registerError").textContent = "Salesman ID must be 4–30 letters or numbers (no spaces)."; return; }
  if (password.length < 6) { $("registerError").textContent = "Password must have at least 6 characters."; return; }
  try {
    $("completeRegisterButton").disabled = true; $("completeRegisterButton").textContent = "Creating account…";
    const user = auth.currentUser, credential = EmailAuthProvider.credential(salesmanEmail(id), password);
    await linkWithCredential(user, credential); await updateProfile(user, { displayName: name });
    await setDoc(doc(db, "users", user.uid), { name, mobile, salesmanId: id, email: salesmanEmail(id), role: "salesman", createdAt: serverTimestamp() }, { merge: true });
    registrationInProgress = false; registerDialog.close(); await handleUser(user);
  } catch (error) { console.error(error); registrationInProgress = false; $("registerError").textContent = error.code === "auth/email-already-in-use" ? "This Salesman ID already exists. Choose another ID." : "Account could not be created. Please try again."; }
  finally { $("completeRegisterButton").disabled = false; $("completeRegisterButton").textContent = "Create Account"; }
});
$("addLeadButton").disabled = true; onAuthStateChanged(auth, handleUser); if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js"); render();
