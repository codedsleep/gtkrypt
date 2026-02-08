# Install the application icons
install_data(
	'icons' / APP_ID + '.svg',
	install_dir: get_option('datadir') / 'icons' / 'hicolor' / 'scalable' / 'apps'
)
install_data(
	'icons' / APP_ID + '-symbolic.svg',
	install_dir: get_option('datadir') / 'icons' / 'hicolor' / 'symbolic' / 'apps'
)

# Install the desktop file
install_data(
	APP_ID + '.desktop',
	install_dir: get_option('datadir') / 'applications'
)

# Install the AppStream metainfo
install_data(
	APP_ID + '.metainfo.xml',
	install_dir: get_option('datadir') / 'metainfo'
)

# Install the MIME type definition
install_data(
	APP_ID + '.mime.xml',
	install_dir: get_option('datadir') / 'mime' / 'packages'
)
