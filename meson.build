# Define our project
project(
	'gtkrypt',
	version: '1.0.0',
	license: ['MIT'],
	meson_version: '>= 1.0.1'
)

APP_ID = 'io.github.gtkrypt'

# Import the modules
gnome = import('gnome')

# Load instructions from subdirectories
subdir('data')
subdir('dist')

# Install the Rust crypto binary (must be pre-built with: cd crypto && cargo build --release)
install_data(
	'crypto' / 'target' / 'release' / 'gtkrypt-crypto',
	install_dir: get_option('bindir'),
	install_mode: 'rwxr-xr-x'
)

# Post installation tasks
gnome.post_install(
	gtk_update_icon_cache: true,
	update_desktop_database: true,
	update_mime_database: true,
)
