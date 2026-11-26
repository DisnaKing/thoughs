# Thoughs

Notas y conceptos que se relacionan solos (enlaces `[[Título]]`, menciones detectadas y similitud de contenido), con grafo. PWA sin build: sirve la carpeta por HTTPS (GitHub Pages, Cloudflare Pages…).

## Sincronización entre dispositivos (Supabase, gratis)

1. Crea un proyecto en https://supabase.com.
2. **SQL Editor → New query**: pega el contenido de `supabase.sql` y pulsa *Run*.
3. (Opcional, más cómodo) **Authentication → Providers → Email**: desactiva *Confirm email* para entrar sin confirmar el correo.
4. **Project Settings → API**: copia la *Project URL* y la clave *anon public*.
5. En la app: **☁ Sincronización** → pega URL y clave → *Crear cuenta* → *Entrar*.
6. En cada otro dispositivo: en el primero pulsa *Copiar enlace para otro dispositivo*, ábrelo allí, y entra con el mismo email y contraseña.

Cómo funciona: cada nota se guarda en local (funciona offline) y se sube en segundo plano; al abrir la app, al volver a ella y cada minuto se bajan los cambios. Si la misma nota se edita en dos sitios, gana la última edición. Los borrados también se sincronizan. La seguridad la da Row Level Security: cada usuario solo ve sus filas, y la clave *anon* es pública por diseño.
