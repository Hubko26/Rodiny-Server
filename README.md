# Rodinný server

Zdieľaný nákupný zoznam pre rodinu (neskôr aj plánovanie a ďalšie veci).
Položky sa pridávajú **iba odkazom na produkt z rohlik.cz** – server z neho dotiahne
názov, obrázok a aktuálnu cenu a priebežne počíta, koľko nákup stojí.

## Automatické spúšťanie

Server sa spúšťa sám po prihlásení do Windows (úloha „Rodinny server“ v Plánovači úloh),
beží bez okna a po páde sa do 5 s spustí znova. Výstup je v `data/server.log`.
Na reštart (napr. po úprave kódu) stačí ukončiť proces `node.exe`, slučka ho spustí znova.
`start.bat` slúži na ručné spustenie s oknom, keď automatická úloha nebeží.

## Spustenie

Potrebuje iba [Node.js](https://nodejs.org) 18 alebo novší, žiadne ďalšie balíčky.

- Dvojklik na `start.bat`, alebo v termináli `node server.js`
- Otvor http://localhost:8080
- Heslá sú v `config.json` (`password`, `adminPassword`). Súbor nie je v gite; pri prvom spustení
  sa vytvorí z `config.example.json`. Po zmene hesla a reštarte sa všetci musia prihlásiť znova.

Dáta sú v `data/shopping.json` (zálohuj si tento priečinok).
Ceny sa obnovujú automaticky každých 6 hodín, alebo tlačidlom „Obnoviť ceny“.

## Ako to funguje

1. Ktokoľvek z rodiny (heslo `password`) pridá produkt odkazom z rohlik.cz. Položka sa objaví v **Požiadavkách na kúpu**.
2. Správca (`adminName`, prihlási sa heslom `adminPassword` z `config.json`) požiadavku potvrdí 🛒, tým ju dá **do košíka**, alebo ju zamietne.
3. Po objednaní klikne správca na **✓ Kúpené**: celý košík sa uloží do **Archívu** ako jeden nákup
   a zároveň ostane na prvej stránke ako **Aktuálny nákup** (na hlasovanie, kto čo zjedol).
4. Tlačidlom **Nový nákup** správca aktuálny nákup z prvej stránky odstráni, ostane už iba v archíve.

**Kto koľko platí:** pri aktuálnom nákupe aj v archíve každý klikne na „🍽 Jedol(a) som“ pri tom,
čo jedol/pil. Cena položky sa delí rovným dielom medzi všetkých, čo klikli. Za položky, pri ktorých
nikto nehlasoval, platí správca. Súhrn „Kto koľko platí“ je pri aktuálnom nákupe a pri každom nákupe v archíve.

Bežní používatelia môžu meniť a mazať iba požiadavky. Košík, nákupy a archív spravuje iba správca.

## Pridanie produktu

Fungujú tieto tvary odkazu:

- `https://www.rohlik.cz/1294559-okurka-hadovka`
- `https://www.rohlik.cz/c300102013-zelenina?productPopup=1294559-okurka`

Ak sa ten istý produkt pridá znova, len sa zvýši počet kusov.

## Prístup zvonku

Server beží na tvojom počítači, takže musí byť zapnutý, keď ho chce niekto použiť.

### Možnosť A: Tailscale Funnel (stála adresa, odporúčané)

1. Nainštaluj Tailscale: `winget install Tailscale.Tailscale` a prihlás sa.
2. V admin konzole Tailscale zapni HTTPS a Funnel.
3. Spusti: `tailscale funnel --bg 8080`
4. Adresa bude napr. `https://tvoj-pc.tvoj-tailnet.ts.net` – tú pošli rodine.

### Možnosť B: Cloudflare Quick Tunnel (bez účtu, adresa sa mení)

1. `winget install Cloudflare.cloudflared`
2. `cloudflared tunnel --url http://localhost:8080`
3. Vypíše adresu `https://náhodné-slová.trycloudflare.com`. Pri každom spustení je iná.

Stálu adresu cez Cloudflare dostaneš, ak máš vlastnú doménu (Cloudflare named tunnel).

### Možnosť C: Presmerovanie portu na routeri

Neodporúčam: odhalí tvoju domácu IP, nemá HTTPS a heslo by išlo sieťou nezašifrované.

## Bezpečnosť

- Heslo je krátke. Server po 10 zlých pokusoch z jednej IP zablokuje prihlasovanie na 10 minút,
  ale pri verejnej adrese zváž dlhšie heslo.
- Prihlásenie platí 90 dní (cookie).
