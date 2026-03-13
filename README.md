# Eren Bingo - Render sürümü

Bu proje, herkesin aynı bingo kartını gördüğü ve izleyicinin claim gönderip hostun 10 saniye içinde onayladığı canlı yayın bingo sistemidir.

## Özellikler

- Aynı kart, tüm izleyiciler için ortak görünüm
- İzleyici claim gönderir
- Host yalnızca bekleyen claim olan kutuyu onaylar
- 10 saniye içinde onay gelmezse claim düşer
- Oda kodu desteği
- Render üzerinde tarayıcıdan çalışan kurulum gerektirmeyen yapı
- Mevcut görseller ve layout korunur, geniş ekranda etraf siyah kalır

## Yerelde çalıştırma

```bash
npm install
HOST_KEY=buraya_guclu_bir_anahtar_yaz npm start
```

Windows PowerShell:

```powershell
$env:HOST_KEY="buraya_guclu_bir_anahtar_yaz"
npm install
npm start
```

## URL'ler

- İzleyici: `/`
- Host: `/host`

Örnek:

- `https://senin-site.onrender.com/?room=anaoda`
- `https://senin-site.onrender.com/host?room=anaoda`

## Render kurulumu

1. Bu projeyi GitHub repo'suna yükle.
2. Render'da **New Web Service** oluştur.
3. Repo'yu bağla.
4. Aşağıdaki env var'ları gir:
   - `HOST_KEY` → host giriş şifresi
   - `DEFAULT_ROOM` → varsayılan oda kodu (ör: `anaoda`)
   - `CLAIM_TTL_MS` → claim süresi (varsayılan `10000`)
5. Deploy et.

`render.yaml` dosyası projede hazır.

## Kullanım akışı

### Host

1. `/host` sayfasına gir.
2. Host key gir.
3. Oda kodu gir veya varsayılanı kullan.
4. İzleyici linkini paylaş.
5. Bekleyen claim gelince ilgili kutuya tıkla veya reddet.

### İzleyici

1. Paylaşılan linke gir.
2. İsterse takma ad yazsın.
3. Duyduğu/tespit ettiği bingo olayında kutuya bassın.
4. Host onaylarsa kutu herkes için kalıcı kapanır.

## Teknik not

State şu anda bellek içinde tutuluyor. Render yeniden başlarsa oda sıfırlanır. İlk sürüm için bu normaldir. Kalıcılık istenirse sonraki aşamada Redis veya Postgres eklenebilir.
