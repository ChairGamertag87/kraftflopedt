# En-tetes de securite du site (audit du 2 sept 2026, point ouvert jusqu'au 28 sept).
# nginx n'herite PAS des add_header d'un bloc parent des qu'un bloc enfant en
# declare un : ce fichier est donc inclus dans le bloc server ET dans chaque
# location qui pose son propre Cache-Control. "always" : aussi sur les 404/5xx.
#
# CSP : le front n'appelle que le site lui-meme (/api/*, /ical/*), les polices
# viennent de Google Fonts, les fonds et le favicon sont des data: URI.
# 'unsafe-inline' sur script-src reste necessaire tant qu'index.html porte des
# onclick= inline ; le retirer une fois les gestionnaires passes en addEventListener.
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()" always;
