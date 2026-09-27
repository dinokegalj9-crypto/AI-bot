# 影 KAGE · Put sjene

Izometrijska akcijska avantura u duhu 8-bitnih nindža klasika iz 1987., napisana od nule za moderni preglednik.
Sva grafika, glazba i zvuk generiraju se kodom pri pokretanju: nema slika, nema samplova, nema preuzetih asseta.

## Pokretanje

| Način | Kako |
|---|---|
| **Windows, dvoklik** | `Pokreni-KAGE.bat` (otvara igru u Edge/Chrome prozoru bez trake) |
| **PowerShell** | `.\Pokreni-KAGE.ps1` · `-Server` za lokalni poslužitelj na `localhost:8642` · `-Browser` za običnu karticu |
| **Bilo koji OS** | otvori `index.html` u Chromeu, Edgeu ili Firefoxu |

Potreban je samo preglednik. Internet služi isključivo za fontove; bez njega igra radi s rezervnim fontovima.

## Kontrole

| Radnja | Tipkovnica | Gamepad |
|---|---|---|
| Kretanje | WASD / strelice | lijeva palica / D-pad |
| Udarac (kombo ×3) | J / lijevi klik | X |
| Jaki kružni udarac | K / desni klik | Y |
| Blok · šuljanje · pariranje | L / Shift | RB / RT |
| Skok | Razmak | A |
| Kolut (neranjiv) | C / Ctrl | B |
| Shuriken | Q | LB |
| Bomba dima | F | LT |
| Promjena oružja | Tab, 1–4 | R3 |
| Karta | M | Select |
| Pauza | Esc / P | Start |

Na mobitelu se pojavljuju virtualna palica i gumbi.

## Što je poboljšano u odnosu na klasike tog žanra

- **Kontrole vezane uz ekran** i kretanje u svim smjerovima umjesto nezgrapnih dijagonala.
- **Nema slučajnih smrti na rubu**: u vodu ili provaliju padaš samo promašenim skokom, a skok koji završi tik uz kamen „zalijepi” se za njega. Pad košta zdravlje, ne život.
- **Borbeni sustav**: kombo od tri udarca, kružni jaki udarac koji probija blok, kolut s neranjivošću, izdržljivost (気), savršeno pariranje koje ruši protivnika i vraća strijele strijelcu, pomoć pri ciljanju.
- **Šuljanje**: stražari imaju vidno polje i mjerač sumnje (? → !), dozivaju jedni druge, a napad s leđa na neopreznog stražara ubija odmah. Bomba dima ih zbunjuje.
- **Pametni neprijatelji**: traženje puta, kruženje oko igrača, najviše dvojica napadaju odjednom, najavljeni udarci (bljesak oštrice). Stražar, kopljanik, strijelac, nindža i šogun s tri faze (juriš, skok s udarnim valom, pozivanje pojačanja).
- **Kontrolne točke** (hramski oltarići) s automatskim spremanjem; *Nastavi* s glavnog izbornika.
- **Dinamična rasvjeta** (fenjeri, baklje, aura igrača), vrijeme (lišće, latice, kiša, žar), krvave mrlje, trešnja kamere, hit-stop, usporeno vrijeme na ključnim udarcima.
- **Adaptivna glazba** u japanskoj *in* ljestvici (koto, šakuhači, taiko) koja pojačava bubnjeve kad te netko lovi, uz eho koji podsjeća na SID čip.
- Karta s maglom neistraženog, prozirni zidovi kad je lik iza njih, CRT filtar, tri težine, gamepad i dodir.

## Struktura

```
index.html             sučelje, izbornici, stilovi
js/util.js             matematika, spremanje, ulaz (tipkovnica, miš, gamepad, dodir)
js/audio.js            WebAudio sintesajzer: glazba i zvučni efekti
js/levels.js           legenda pločica i četiri razine
js/render.js           izometrijski prikaz, skeletni likovi, svjetlo, čestice
js/actors.js           sudari, traženje puta, igrač, AI neprijatelja, borba, šef
js/game.js             tijek igre, HUD, karta, izbornici, glavna petlja
tools/check-levels.js  provjera da su ključevi, oružje i izlaz dostižni (node tools/check-levels.js)
```

KAGE je originalno djelo: likovi, priča, razine, grafika i glazba ne potječu iz nijedne postojeće igre.
