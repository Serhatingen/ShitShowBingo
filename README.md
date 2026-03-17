# ShitShowBingo / Eren Bingo

Bu sürüm mobilde, tablette ve masaüstünde çalışacak şekilde ayarlandı. Uygulama herhangi bir ek program istemez; sadece tarayıcıdan açılır.

## Bu sistem ne yapıyor?

Bu uygulama canlı yayın sırasında ortak bir bingo kartı üzerinde çalışır.

- Herkes aynı kartı görür.
- İzleyici bir kutuya basınca bu hemen kalıcı olmaz.
- Önce "bekleyen istek" olarak server'a gider.
- Host bu isteği onaylarsa kutu herkes için kapanır.
- Onay gelmezse istek süre dolunca silinir.
- Bingo oluşursa sıralama tutulur.

Kısacası sistem "izleyici fark eder, host doğrular" mantığıyla çalışır.

## Kim ne yapıyor?

### Host / yayıncı

- `/host` sayfasına girer.
- O anki yayın için bir **oda kodu** belirler.
- Aynı yayın için bir **host anahtarı** belirler.
- Sisteme bağlanır.
- İzleyici linkini kopyalar ve paylaşır.
- Gelen claim'leri onaylar veya reddeder.

### İzleyici

- Paylaşılan izleyici linkine girer.
- Kullanıcı adını yazar.
- Odaya bağlanır.
- Yayında geçen ifadeyi fark edince ilgili kutuya basar.
- Host onaylarsa kutu kalıcı kapanır.

## Mobilde ve her ekran boyutunda nasıl çalışıyor?

Bu sürümde kart artık sabit piksel genişliğine kilitli değil.

- Kart oranı korunur.
- Ekran küçülünce kart da küçülür.
- Görsel düzen bozulmaz.
- Telefon ekranında sağ panel aşağı iner.
- Butonlar ve giriş alanları parmakla basmaya uygun hale gelir.
- Büyük kutlama overlay'leri de küçük ekrana göre küçülür.

Yani masaüstünde yan yana, telefonda ise üst-alt akışla çalışır.

## Güvenlik mantığı çok basit anlatım

Bu bölüm teknik bilmeyen biri için.

### 1) Host anahtarı neden var?

Her yayında host kendi anahtarını belirler. Bu anahtar, yayıncının kontrol paneline başkasının girmesini zorlaştırır.

Yani izleyici sadece oda linkini görür. Host şifresini görmez.

### 2) İzleyici kutuyu neden direkt kapatamıyor?

Çünkü kötüye kullanım olabilir. Bir izleyici rastgele kutu kapatmaya çalışabilir.

Bunu engellemek için:

- izleyici sadece talep gönderir,
- son karar hosttadır.

Yani sistemde tek başına kimse sonucu değiştiremez.

### 3) Veriler nerede tutuluyor?

Oyun durumu Render üzerindeki çalışan server'da tutulur.

Bu şu anlama gelir:

- yayıncı bilgisayarını sunucu gibi açık tutmak zorunda değildir,
- izleyici bilgisayarında ek program çalışmaz,
- herkes sadece siteye girer.

### 4) Host anahtarı tamamen askeri üs seviyesinde mi?

Hayır. Bu sistem pratik koruma sağlar, banka kasası değildir. Ama yayın akışı için yeterli ve mantıklı bir ayrım sağlar.

Daha ileri güvenlik istenirse sonradan şu eklenebilir:

- admin oturumu için kalıcı hesap sistemi
- rate limit
- IP bazlı koruma
- reverse proxy / bot koruması

## Çalıştırılan cihaza neden yük bindirmez?

Çünkü ağır işi telefon ya da bilgisayar değil, server yapar.

Kullanıcının cihazında olan şeyler şunlardır:

- sayfayı açmak
- görselleri göstermek
- küçük tıklama olayları
- server ile hafif veri alışverişi yapmak

Gönderilen veri çok küçüktür. Genelde sadece şunlar gidip gelir:

- oda kodu
- kullanıcı adı
- hangi kutuya basıldığı
- onay bilgisi
- bingo sırası

Video işleme, büyük dosya üretme, arka planda CPU sömüren ağır bir işlem yoktur. Bu yüzden normal bir telefon ya da sıradan bir laptop için yük çok düşüktür.

## Render üzerinde sıfırdan kurulum

### 1. GitHub reposuna kodu yükle
Repo içinde en az bunlar olmalı:

- `server.js`
- `package.json`
- `render.yaml`
- `public/`

### 2. Render'a gir
- Dashboard aç.
- **New +**
- **Web Service**

### 3. GitHub repo'yu bağla
Repo olarak kendi repoyu seç.

### 4. Ayarlar
- **Environment**: `Node`
- **Branch**: `main`
- **Build Command**: `npm install`
- **Start Command**: `node server.js`

### 5. Deploy et
Render repoyu indirir, paketleri kurar ve server'ı başlatır.

### 6. Açılan linkler
- İzleyici: `/`
- Host: `/host`

## Kullanım adımları

### Yayıncı için
1. `/host` sayfasını aç.
2. Oda kodu yaz.
3. Host anahtarı yaz.
4. Host olarak bağlan.
5. Sistemden üretilen izleyici linkini paylaş.
6. Gelen claim'leri onayla.

### İzleyici için
1. Linke gir.
2. Kullanıcı adını yaz.
3. Odaya bağlan.
4. Yayında geçen ifadeyi gördüğünde ilgili kutuya bas.
5. Host onaylarsa kutu kapanır.
6. Bingo olursa sıralaman görünür.

## Güncelleme nasıl yapılır?

Kodda değişiklik yaptıktan sonra:

```bash
git add .
git commit -m "guncelleme"
git push
```

Render bunu algılar ve yeniden deploy eder.

## Not

Bu sürümde oda durumu bellekte tutulur. Yani servis yeniden başlarsa oda sıfırlanır. Bu yayın tipi için çoğu durumda sorun olmaz. Ama kalıcılık istenirse sonradan Redis veya Postgres eklenebilir.
