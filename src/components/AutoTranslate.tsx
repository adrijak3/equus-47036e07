import { useEffect } from "react";
import { useLanguage } from "@/contexts/LanguageContext";

/**
 * Completes the LT/EN switch for legacy screens that still contain Lithuanian
 * text directly in JSX. New screens should preferably use LanguageContext.t().
 */
const PHRASES: Array<[string, string]> = [
  ["Svarbi informacija apie sutartį ir balnojimo tvarką.", "Important information about the agreement and saddling procedure."],
  ["Jojimo paslaugų sutartis", "Riding services agreement"],
  ["Kiekvienas raitelis privalo pasirašyti šią sutartį prieš pirmąją treniruotę. Be pasirašytos sutarties treniruotė nevyks.", "Every rider must sign this agreement before their first lesson. A lesson cannot take place without a signed agreement."],
  ["Peržiūrėti sutartį", "View agreement"], ["Atsisiųsti PDF", "Download PDF"],
  ["Balnojimo eiga", "Saddling procedure"],
  ["Tvarka, kurios privalo laikytis kiekvienas raitelis prieš ir po treniruotės.", "The procedure every rider must follow before and after a lesson."],
  ["Prieš atsivedant žirgą būtina iškrapštyti kanopas garde.", "Before bringing the horse out, pick out its hooves in the stall."],
  ["Gardinę gūnią prieš vedant balnotis reikia palikti garde.", "Leave the stable rug in the stall before taking the horse to be saddled."],
  ["Žirgas turi būti švariai iššukuotas, ypač nugaros ir pilvo srityje, kur dedasi pavarža.", "The horse must be groomed thoroughly, especially around the back and girth area."],
  ["Pabalnojus žirgą, prieš dedant kamanas, balnojimo vieta privalo būti iššluota — tai, kas sušluota, metama į karutį.", "After saddling and before putting on the bridle, sweep the saddling area and place the debris in the wheelbarrow."],
  ["Prieš įeinant į maniežą privaloma apsižvalgyti, jog netrukdytum kitiems raiteliams.", "Before entering the arena, look around and make sure you will not obstruct other riders."],
  ["Prieš lipant ant žirgo būtina patikrinti kilpų ilgį ir dar kartą paveržti balną.", "Before mounting, check the stirrup length and tighten the girth once more."],
  ["Po jojimo žirgas turi būti nubalnotas ir su prakaitine gūnia kuo greičiau pastatytas į jam priskirtą gardą.", "After riding, untack the horse and return it to its assigned stall with a cooler rug as soon as possible."],
  ["Balnojimo vieta privalo būti sutvarkyta — baltas smėlis grąžinamas į maniežą.", "The saddling area must be left tidy, and white sand should be returned to the arena."],
  ["Inventorius išvalytas ir sutvarkytas: nuplauti žąslai, iš kilpų išvalytas smėlis, viskas padėta į savo vietą.", "Clean and put away all equipment: rinse the bit, remove sand from the stirrups, and return everything to its place."],
  ["Žirgui nudžiuvus — turi būti perrengtas į jo gardo gūnią; prakaitinė gūnia gražiai sulankstyta ir padėta į vietą.", "Once the horse is dry, put on its stable rug, fold the cooler neatly, and return it to its place."],
  ["Tvarkinga balnojimo vieta — saugumas tau, žirgui ir kitiems raiteliams.", "A tidy saddling area keeps you, the horse, and other riders safe."],
  ["Individualiai treniruotei laiką reikia suderinti su Laura. Susitarus, parašykite žinutę administracijai per savo paskyrą („Žinutės\" skiltyje), kad būtumėte užregistruoti tuo ir tuo laiku individualiai treniruotei.", "Arrange an individual lesson time with Laura. Once agreed, message the administration through the Messages section of your account so they can register you."],

  ["Sveiki atvykę į Equus!", "Welcome to Equus!"], ["Sveiki sugrįžę!", "Welcome back!"],
  ["El. paštas arba telefonas", "Email or phone"], ["El. paštas", "Email"], ["Telefono numeris", "Phone number"],
  ["Slaptažodis", "Password"], ["Naujas slaptažodis", "New password"], ["Pakartokite slaptažodį", "Repeat password"],
  ["Vardas ir pavardė", "Full name"], ["Pamiršote slaptažodį?", "Forgot your password?"],
  ["Sukurti paskyrą", "Create account"], ["Pakeisti slaptažodį", "Change password"],
  ["Įveskite paskyros el. paštą ir telefono numerį. Jei jie sutaps su paskyra – galėsite iškart nustatyti naują slaptažodį.", "Enter the email and phone number connected to your account. If they match, you can set a new password immediately."],
  ["Neteisingas el. paštas arba slaptažodis", "Incorrect email or password"], ["Neteisingas telefonas arba slaptažodis", "Incorrect phone number or password"],
  ["Slaptažodis turi būti bent 8 simbolių", "Password must contain at least 8 characters"], ["Slaptažodžiai nesutampa", "Passwords do not match"],
  ["Slaptažodis pakeistas. Galite prisijungti.", "Password changed. You can now sign in."],

  ["Svarbiausia šiandienos informacija ir greiti administravimo veiksmai.", "Today's key information and quick administration actions."],
  ["Šiandienos informacija ir greita prieiga prie trenerio srities.", "Today's information and quick access to the trainer area."],
  ["Čia visada rasite artimiausią treniruotę ir svarbiausią informaciją.", "Your next lesson and the most important information are always shown here."],
  ["Šiandienos rezervacijos", "Today's bookings"], ["Unikalūs raiteliai", "Unique riders"],
  ["Laukimo sąraše", "On the waiting list"], ["Atšaukta šiandien", "Cancelled today"],
  ["Kita treniruotė", "Next lesson"], ["Bus paskirtas vėliau", "Will be assigned later"],
  ["Iki treniruotės liko", "Time until lesson"], ["Šiuo metu neturite suplanuotų būsimų treniruočių.", "You currently have no upcoming lessons."],
  ["Atidaryti grafiką", "Open schedule"], ["Registruotis į treniruotę", "Book a lesson"], ["Šią savaitę", "This week"],

  ["Prisijunkite, kad užsiregistruotumėte", "Sign in to book a lesson"], ["Negalima registruotis į praeities pamokas", "You cannot book past lessons"],
  ["Jūs jau užregistruoti į šią pamoką", "You are already booked for this lesson"], ["Užregistruota!", "Booked!"],
  ["Jau esate laukiančiųjų sąraše", "You are already on the waiting list"], ["Pridėta į laukiančiųjų sąrašą", "Added to the waiting list"],
  ["Pašalinta iš laukiančiųjų", "Removed from the waiting list"], ["Pamoka atšaukta", "Lesson cancelled"],
  ["Atšaukti pamoką?", "Cancel lesson?"], ["Pamoka bus pažymėta kaip atšaukta.", "The lesson will be marked as cancelled."],
  ["Įveskite atšaukimo priežastį", "Enter the cancellation reason"], ["Patvirtinti atšaukimą", "Confirm cancellation"],
  ["Atšaukti tik šią pamoką?", "Cancel only this lesson?"], ["Nuolatinis laikas išliks ateities savaitėms.", "The recurring time will remain for future weeks."],
  ["Pašalinti nuolatinį laiką VISAM laikui?", "Remove this recurring time permanently?"],
  ["Visos jūsų būsimos pamokos šiuo laiku bus atšauktos. Šio veiksmo atšaukti negalėsite.", "All your future lessons at this time will be cancelled. This action cannot be undone."],
  ["Laukiančiųjų sąrašas", "Waiting list"], ["Pridėti vietą", "Add a place"], ["Pašalinti papildomą vietą", "Remove extra place"],
  ["Pridėti +1 vietą šiai treniruotei", "Add one place to this lesson"], ["Pridėti naują laiką šiai dienai", "Add a new time for this day"],
  ["Pridėti / redaguoti dienos žinutę", "Add or edit the day's message"], ["Atšaukti visą dieną", "Cancel the entire day"],
  ["Diena grąžinta į tvarkaraštį", "Day restored to the schedule"], ["Žinutė išsaugota", "Message saved"],
  ["Nuolatinė žinutė pašalinta", "Recurring message removed"], ["Žinutė pašalinta", "Message removed"],
  ["Priežastis (nebūtina):", "Reason (optional):"], ["Trumpai aprašykite...", "Briefly describe..."],
  ["Pvz. Treniruotė vyks lauke, atsineškite šalmus.", "E.g. The lesson will take place outdoors; bring your helmets."],
  ["Pridėti kaip individualią treniruotę", "Add as an individual lesson"], ["Vardas (ir pavardė)", "Name (and surname)"],
  ["Įveskite svečio vardą", "Enter the guest's name"], ["Svečias", "Guest"], ["naujokė", "new rider"],
  ["Vieta pridėta (+1)", "Place added (+1)"], ["Papildoma vieta pašalinta", "Extra place removed"],
  ["Įveskite teisingą laiką (HH:MM)", "Enter a valid time (HH:MM)"], ["Pasirinkite vartotoją", "Select a user"],
  ["Vartotojas jau užregistruotas", "User is already booked"], ["Individuali pridėta", "Individual lesson added"],
  ["Pasiekta 15 nuorodų riba", "The limit of 15 links has been reached"], ["Įveskite pilną nuorodą (https://...)", "Enter the full link (https://...)"],
  ["Diena atšaukta. Visi tos dienos rezervavimai atšaukti.", "Day cancelled. All bookings for that day have been cancelled."],
  ["Atšaukta. Pažyma įkelta — laukia administracijos.", "Cancelled. The medical document was uploaded and is awaiting administration review."],
  ["Atšaukta. Iki 7 d. pridėkite pažymą paskyroje.", "Cancelled. Add the medical document in your account within 7 days."],
  ["Atšaukta. Laukia administracijos sprendimo.", "Cancelled. Awaiting an administration decision."],

  ["Užsirašytos treniruotės", "Upcoming lessons"], ["Nėra suplanuotų treniruočių", "No lessons scheduled"],
  ["Įvykusios treniruotės", "Completed lessons"], ["Dar nebuvo įvykusių treniruočių", "No completed lessons yet"],
  ["Atšauktos treniruotės", "Cancelled lessons"], ["Atšauktų treniruočių nėra", "No cancelled lessons"],
  ["Nėra abonementų", "No lesson packages"], ["Liko ≤1 treniruotė", "≤1 lesson remaining"],
  ["Ligos pažymos", "Medical documents"], ["Terminas pasibaigęs — laukia administracijos sprendimo", "Deadline expired — awaiting an administration decision"],
  ["Pranešta administracijai — prisekite failą žinučių skiltyje", "Administration notified — attach the file in the Messages section"],
  ["Pažymėta apmokėta. Administracija patvirtins.", "Marked as paid. Administration will confirm it."],
  ["Abonementas ištrintas", "Lesson package deleted"], ["Abonementas pridėtas", "Lesson package added"],
  ["Žinutė išsiųsta", "Message sent"], ["Rašykite čia...", "Write here..."], ["Perskaityta", "Read"], ["Išsiųsta", "Sent"],
  ["Pakeisti treniruočių skaičių", "Change number of lessons"], ["Spauskite, kad pažymėtumėte kaip apmokėtą", "Click to mark as paid"],
  ["Ištrinti šį abonementą", "Delete this lesson package"], ["Įvyko (nesiskaičiuoja)", "Completed (not counted)"],

  ["Apžvalga", "Overview"], ["Tvarkaraštis", "Schedule"], ["Atšaukimai", "Cancellations"], ["Žinutės", "Messages"],
  ["Aktyvūs abonementai", "Active lesson packages"], ["Neapmokėti abonementai", "Unpaid lesson packages"],
  ["Šios sav. treniruotės", "Lessons this week"], ["Nauj. žinutės", "New messages"], ["Laukiantys atšaukimai", "Pending cancellations"],
  ["Rezervacijos šią savaitę", "Bookings this week"], ["Užimtumas", "Occupancy"], ["Pokytis nuo praėjusios sav.", "Change from last week"],
  ["Atšaukimų dalis", "Cancellation rate"], ["Rezervacijų tendencija · 8 savaitės", "Booking trend · 8 weeks"],
  ["Užimtumas pagal savaitės dieną", "Occupancy by weekday"], ["Skaičiuojama statistika…", "Calculating statistics…"],
  ["Vartotojų", "Users"], ["Aktyvių abon.", "Active packages"], ["Neapmokėtų", "Unpaid"], ["Šio mėn. pamokos", "Lessons this month"],
  ["Iš jų liga", "Medical cancellations"], ["Ieškoti vartotojo...", "Search users..."], ["Pridėti abonementą", "Add lesson package"],
  ["Įvykusios pamokos, neįskaičiuotos į apmokėtą abonementą", "Completed lessons not included in a paid lesson package"],
  ["Žiūrėti, kurios pamokos įskaičiuotos", "View which lessons are included"], ["Neįskaičiuotų pamokų nėra šio abonemento laikotarpyje", "There are no uncounted lessons during this package period"],
  ["Pamoka skaičiuosis", "Lesson will be counted"], ["Pamoka neskaičiuosis", "Lesson will not be counted"],
  ["Pažyma neįkelta — terminas pasibaigęs", "Document not uploaded — deadline expired"], ["Pamoką atidirbti iki sekmadienio (tos pačios savaitės)", "Make up the lesson by Sunday of the same week"],
  ["Rašykite atsakymą...", "Write a reply..."], ["Atsakymas išsiųstas", "Reply sent"], ["Jūs (admin)", "You (admin)"],
  ["Šią dieną tvarkaraštyje nėra grupinių pamokų — pasirink „Individuali\".", "There are no group lessons on this day — select Individual."],

  ["Žirgai", "Horses"], ["Žirgas pridėtas", "Horse added"], ["Žirgo duomenys atnaujinti", "Horse details updated"],
  ["Žirgas vėl aktyvus", "Horse is active again"], ["Žirgas pašalintas iš aktyvaus sąrašo", "Horse removed from the active list"],
  ["Ieškoti žirgo…", "Search horses…"], ["Ieškoti pagal vardą…", "Search by name…"], ["Žirgas priskirtas", "Horse assigned"],
  ["Šis žirgas jau pasiekė dienos limitą.", "This horse has already reached its daily limit."], ["neapmokėta", "unpaid"],

  ["Sutarties ir taisyklių peržiūra", "Agreement and rules review"], ["Equus sutarties peržiūra", "Equus agreement review"],
  ["Atšaukimo tvarka", "Cancellation policy"], ["Sutarties pasirašymas", "Signing the agreement"], ["Žirgyno taisyklės", "Stable rules"],
  ["Perskaitėte iki galo", "You have read to the end"], ["Slinkite žemyn iki pat pabaigos, kad galėtumėte sutikti.", "Scroll all the way to the bottom before accepting."],
  ["Susipažinau su taisyklėmis, kainomis, atšaukimo tvarka ir sutarties pasirašymo priminimu.", "I have reviewed the rules, prices, cancellation policy, and agreement-signing reminder."],
  ["Sutinku ir tęsti", "Agree and continue"], ["Ačiū! Sveiki atvykę į Equus 🐴", "Thank you! Welcome to Equus 🐴"],

  ["Automatinė", "Automatic"], ["Tema keičiasi pagal metų laiką.", "The theme changes with the season."],
  ["Rožinė sakurų tema.", "Pink sakura theme."], ["Geltonas, violetinis ir aqua saulėlydis.", "Yellow, purple, and aqua sunset."],
  ["Karamelė, varis ir klevo lapai.", "Caramel, copper, and maple leaves."], ["Tamsi arktinė Equus tema.", "Dark arctic Equus theme."],
  ["Pagal sezoną", "Season default"], ["Šviesi", "Light"], ["Tamsi", "Dark"], ["Šviesumas", "Brightness"],
  ["Tamsus pavasaris tampa rožiniu vakaru, o tamsi vasara – tropine naktimi.", "Dark Spring becomes a pink evening, while Dark Summer becomes a tropical night."],

  ["1 treniruotė", "1 lesson"], ["4 treniruotės", "4 lessons"], ["8 treniruotės", "8 lessons"],
  ["1 individuali treniruotė", "1 individual lesson"], ["Individuali treniruotė", "Individual lesson"], ["Treniruotės", "Lessons"],
  ["Mažylio svajonė", "Little Rider's Dream"], ["Informacija", "Information"], ["Kainos", "Prices"],

  ["Pirmadienis", "Monday"], ["Antradienis", "Tuesday"], ["Trečiadienis", "Wednesday"], ["Ketvirtadienis", "Thursday"],
  ["Penktadienis", "Friday"], ["Šeštadienis", "Saturday"], ["Sekmadienis", "Sunday"],
  ["Sausis", "January"], ["Vasaris", "February"], ["Kovas", "March"], ["Balandis", "April"], ["Gegužė", "May"], ["Birželis", "June"],
  ["Liepa", "July"], ["Rugpjūtis", "August"], ["Rugsėjis", "September"], ["Spalis", "October"], ["Lapkritis", "November"], ["Gruodis", "December"],

  ["Išsaugoti", "Save"], ["Išsaugoma…", "Saving…"], ["Saugoma…", "Saving…"], ["Išsaugota", "Saved"],
  ["Pridėti", "Add"], ["Pridedama…", "Adding…"], ["Pridėta", "Added"], ["Pašalinti", "Remove"], ["Pašalinta", "Removed"],
  ["Atšaukti", "Cancel"], ["Atšaukta", "Cancelled"], ["Uždaryti", "Close"], ["Redaguoti", "Edit"], ["Patvirtinti", "Confirm"],
  ["Taip", "Yes"], ["Ne", "No"], ["Nebūtina", "Optional"], ["Pastaba (nebūtina)", "Note (optional)"],
  ["Žinutė", "Message"], ["Dienos žinutė", "Day message"], ["Redaguoti žinutę", "Edit message"],
  ["Žirgas", "Horse"], ["Raitelis", "Rider"], ["Vartotojas", "User"], ["Data", "Date"], ["Laikas", "Time"],
  ["Talpa", "Capacity"], ["Laisvos vietos", "Available places"], ["Pilna", "Full"], ["Liko vietų", "Places left"],
  ["Individuali", "Individual"], ["Grupinė", "Group"], ["Nuolatinė", "Recurring"], ["Vienkartinė", "One-time"],
  ["Apmokėta", "Paid"], ["Neapmokėta", "Unpaid"], ["Aktyvus", "Active"], ["Neaktyvus", "Inactive"],
];

const originalText = new WeakMap<Text, string>();
const renderedText = new WeakMap<Text, string>();
const originalAttributes = new WeakMap<Element, Map<string, string>>();
const ATTRIBUTES = ["placeholder", "title", "aria-label"];

function translate(input: string): string {
  let output = input;
  for (const [lt, en] of PHRASES) {
    if (output.includes(lt)) output = output.split(lt).join(en);
  }
  return output;
}

function shouldSkip(element: Element | null) {
  return Boolean(element?.closest("[data-no-translate], script, style, code, pre"));
}

function applyTextNode(node: Text, english: boolean) {
  if (shouldSkip(node.parentElement)) return;
  const current = node.nodeValue ?? "";
  const lastRendered = renderedText.get(node);
  if (!originalText.has(node) || (lastRendered !== undefined && current !== lastRendered)) {
    originalText.set(node, current);
  }
  const original = originalText.get(node) ?? current;
  const next = english ? translate(original) : original;
  if (current !== next) node.nodeValue = next;
  renderedText.set(node, next);
}

function applyElement(element: Element, english: boolean) {
  if (shouldSkip(element)) return;
  let stored = originalAttributes.get(element);
  if (!stored) {
    stored = new Map();
    originalAttributes.set(element, stored);
  }
  for (const attribute of ATTRIBUTES) {
    const current = element.getAttribute(attribute);
    if (current == null) continue;
    if (!stored.has(attribute)) stored.set(attribute, current);
    const original = stored.get(attribute) ?? current;
    const next = english ? translate(original) : original;
    if (current !== next) element.setAttribute(attribute, next);
  }
}

function applyTree(root: Node, english: boolean) {
  if (root.nodeType === Node.TEXT_NODE) applyTextNode(root as Text, english);
  if (root.nodeType === Node.ELEMENT_NODE) applyElement(root as Element, english);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) applyTextNode(node as Text, english);
    else applyElement(node as Element, english);
    node = walker.nextNode();
  }
}

export function AutoTranslate() {
  const { language } = useLanguage();

  useEffect(() => {
    const english = language === "en";
    applyTree(document.body, english);

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData") applyTextNode(mutation.target as Text, english);
        for (const node of mutation.addedNodes) applyTree(node, english);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [language]);

  return null;
}
