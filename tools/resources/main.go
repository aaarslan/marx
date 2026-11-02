package main

import (
	"github.com/tc-hib/winres"
	"github.com/tc-hib/winres/version"
	"os"
)

func generate() error {
	resources := winres.ResourceSet{}
	icon, err := os.Open("build/icon.ico")
	if err != nil {
		return err
	}
	defer icon.Close()
	image, err := winres.LoadICO(icon)
	if err != nil {
		return err
	}
	if err = resources.SetIcon(winres.RT_ICON, image); err != nil {
		return err
	}
	manifest, err := os.ReadFile("build/windows.manifest")
	if err != nil {
		return err
	}
	parsed, err := winres.AppManifestFromXML(manifest)
	if err != nil {
		return err
	}
	resources.SetManifest(parsed)
	data, err := os.ReadFile("build/windows-info.json")
	if err != nil {
		return err
	}
	var info version.Info
	if err = info.UnmarshalJSON(data); err != nil {
		return err
	}
	resources.SetVersionInfo(info)
	output, err := os.Create("native/resource_windows_amd64.syso")
	if err != nil {
		return err
	}
	defer output.Close()
	return resources.WriteObject(output, winres.ArchAMD64)
}
func main() {
	if generate() != nil {
		os.Stderr.WriteString("Windows resource generation failed.\n")
		os.Exit(1)
	}
}
